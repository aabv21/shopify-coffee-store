// The offline preview's fonts and the CSS variables derived from the theme settings.
import { type Rgb, brightness, channels, hoverShift, parseHex, toHex } from './color.ts';
import { isRecord, type Settings, setting } from './theme-preview.ts';

interface PreviewFont { family: string; fallback: string }

// The Shopify font library families this preview can stand in for. Shopify serves them from its
// own font CDN; the preview loads the same families from Google Fonts. An unlisted family fails
// loudly instead of silently rendering in a system font.
export const PREVIEW_FONTS: ReadonlyMap<string, PreviewFont> = new Map([
  ['alegreya', { family: 'Alegreya', fallback: 'serif' }],
  ['alegreya_sans', { family: 'Alegreya Sans', fallback: 'sans-serif' }],
  ['inter', { family: 'Inter', fallback: 'sans-serif' }],
]);

export interface FontHandle { key: string; family: string; fallback: string; weight: number; style: 'normal' | 'italic' }

/** Parses a Shopify font handle such as `alegreya_sans_n4` (family, `n`/`i` style, weight / 100). */
export function parseFontHandle(handle: unknown): FontHandle {
  const match = typeof handle === 'string' ? /^([a-z0-9_]+)_([ni])([1-9])$/.exec(handle) : null;
  if (!match) throw new Error(`not a Shopify font handle: ${JSON.stringify(handle)}`);
  const [, key = '', style, weight = '4'] = match;
  const font = PREVIEW_FONTS.get(key);
  if (!font) throw new Error(`font ${String(handle)} is not in PREVIEW_FONTS; add its family to preview it`);
  return { key, ...font, weight: Number(weight) * 100, style: style === 'i' ? 'italic' : 'normal' };
}

const FONT_ROLES = ['body', 'subheading', 'heading', 'accent'] as const;

/** A Google Fonts stylesheet URL for every font role, in its own weight and bold (Horizon's `font_modify: 'weight', 'bold'`). */
export function previewFontsUrl(settings: Settings): string {
  const weights = new Map<string, Set<number>>();
  for (const role of FONT_ROLES) {
    const font = parseFontHandle(setting(settings, `type_${role}_font`));
    const set = weights.get(font.family) ?? new Set<number>();
    set.add(font.weight).add(700);
    weights.set(font.family, set);
  }
  const families = [...weights].map(([family, set]) => `family=${family.replaceAll(' ', '+')}:wght@${[...set].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

// ---------------------------------------------------------------------------------------------
// CSS variables
// ---------------------------------------------------------------------------------------------

const REQUIRED_STATIC_VARIABLES = ['--gap-md', '--font-size--sm', '--focus-outline-width', '--opacity-10', '--animation-speed'];

/**
 * The Liquid-free part of Horizon's `snippets/theme-styles-variables.liquid` `:root` block (gaps,
 * fixed font sizes, opacities, focus, motion, ...), copied verbatim so the preview never drifts
 * from the pinned Horizon. Any line that contains Liquid is dropped; `themeCssVariables` computes
 * the settings-driven values instead. Throws when the block or a variable the components use is
 * missing, which means Horizon restructured the file.
 */
export function staticRootVariables(source: string): string {
  const start = source.indexOf(':root {');
  if (start === -1) throw new Error('theme-styles-variables.liquid: no :root block');

  const kept: string[] = [];
  let depth = 0;
  let inLiquidTag = false;
  for (const line of source.slice(start).split('\n')) {
    if (inLiquidTag) {
      if (line.includes('%}')) inLiquidTag = false;
      continue;
    }
    if (line.includes('{%') && !line.includes('%}')) {
      inLiquidTag = true;
      continue;
    }
    if (line.includes('{{') || line.includes('{%')) continue;

    kept.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth === 0) break;
  }

  const css = kept.join('\n');
  const missing = REQUIRED_STATIC_VARIABLES.filter((name) => !css.includes(`${name}:`));
  if (missing.length > 0) throw new Error(`theme-styles-variables.liquid: missing ${missing.join(', ')}`);
  return css;
}

const TYPE_PRESETS = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const FLUID_SIZE_CUTOFF = 48;
const ABSOLUTE_FONT_SIZE_MIN = 10;

const rem = (px: number): string => `${Number((px / 16).toFixed(4)).toString()}rem`;

/** Horizon's type-preset sizes: fixed below 48px, a `clamp()` from the next smaller size above it. */
export function presetFontSizes(settings: Settings): Record<string, string> {
  const sizes = new Map(TYPE_PRESETS.map((preset) => [preset, Number(setting(settings, `type_size_${preset}`))]));
  const sorted = [...new Set(sizes.values())].sort((a, b) => a - b);
  const result = new Map<string, string>();
  for (const [preset, size] of sizes) {
    if (!Number.isFinite(size) || size <= 0) throw new Error(`settings: type_size_${preset} is not a size`);
    if (size < FLUID_SIZE_CUTOFF) {
      result.set(preset, rem(size));
      continue;
    }
    const next = sorted[sorted.indexOf(size) - 1];
    let min = ABSOLUTE_FONT_SIZE_MIN;
    if (next !== undefined) min = next < FLUID_SIZE_CUTOFF ? Math.min(next + 4, size) : next;
    result.set(preset, `clamp(${rem(min)}, ${Number((size * 0.1).toFixed(4)).toString()}vw, ${rem(size)})`);
  }
  return Object.fromEntries(result);
}

const rgbFunction = (color: Rgb): string => `rgb(${channels(color)} / 1.0)`;

/**
 * The settings-driven Horizon CSS variables the components and the base styles they rely on read:
 * colors (Horizon's `snippets/color-palette.liquid`), fonts and type presets, radii, and button
 * fonts (`snippets/theme-styles-variables.liquid`). Values follow Horizon's Liquid formulas for
 * opaque colors; anything else (semi-transparent colors, per-section overrides) is out of scope.
 */
export function themeCssVariables(settings: Settings): string {
  const vars: [string, string][] = [];
  const color = (id: string): Rgb => parseHex(setting(settings, id));

  const background = color('page_background_color');
  const foreground = color('page_text_color');
  const paletteSetting = setting(settings, 'color_palette');
  const palette = isRecord(paletteSetting) ? Object.values(paletteSetting).map(parseHex) : [];
  if (palette.length < 2) throw new Error('settings: color_palette needs at least two colors');
  const lightest = palette.reduce((a, b) => (brightness(b) > brightness(a) ? b : a));
  const darkest = palette.reduce((a, b) => (brightness(b) < brightness(a) ? b : a));
  const dark = brightness(background) < 64;

  vars.push(
    ['--color-background', toHex(background)],
    ['--color-background-rgb', channels(background)],
    ['--color-foreground', toHex(foreground)],
    ['--color-foreground-rgb', channels(foreground)],
    ['--color-border', toHex(foreground)],
    ['--color-border-rgb', channels(foreground)],
    ['--palette-lightest', toHex(lightest)],
    ['--palette-lightest-rgb', channels(lightest)],
    ['--palette-darkest', toHex(darkest)],
    ['--palette-darkest-rgb', channels(darkest)],
    ['--opacity-5-15', dark ? '0.15' : '0.05'],
    ['--opacity-10-25', dark ? '0.25' : '0.1'],
    ['--opacity-35-55', dark ? '0.55' : '0.35'],
    ['--opacity-40-60', dark ? '0.60' : '0.40'],
    ['--opacity-30-60', dark ? '0.60' : '0.30'],
  );

  for (const kind of ['primary', 'secondary'] as const) {
    const text = color(`palette_${kind}_button_text`);
    const fill = color(`palette_${kind}_button_background`);
    const border = color(`palette_${kind}_button_border`);
    const hoverFill = hoverShift(fill);
    const hoverText = brightness(hoverFill) > 128 ? darkest : lightest;
    const hoverBorder = toHex(border) === toHex(fill) ? hoverFill : hoverShift(border);
    vars.push(
      [`--color-${kind}-button-text`, rgbFunction(text)],
      [`--color-${kind}-button-background`, rgbFunction(fill)],
      [`--color-${kind}-button-border`, rgbFunction(border)],
      [`--color-${kind}-button-hover-text`, rgbFunction(hoverText)],
      [`--color-${kind}-button-hover-background`, toHex(hoverFill)],
      [`--color-${kind}-button-hover-border`, toHex(hoverBorder)],
    );
    if (kind === 'primary') vars.push(['--color-primary-button-focus-outline', `rgb(${channels(fill)})`]);
  }

  const inputText = color('palette_input_text');
  vars.push(
    ['--color-input-background', rgbFunction(color('palette_input_background'))],
    ['--color-input-text', rgbFunction(inputText)],
    ['--color-input-text-rgb', channels(inputText)],
    ['--color-input-border', rgbFunction(color('palette_input_border'))],
    ['--color-foreground-muted', 'rgb(var(--color-rgb, var(--color-foreground-rgb)) / var(--opacity-muted-text))'],
    ['--color-foreground-subdued', 'rgb(var(--color-rgb, var(--color-foreground-rgb)) / var(--opacity-subdued-text))'],
  );

  for (const role of FONT_ROLES) {
    const font = parseFontHandle(setting(settings, `type_${role}_font`));
    vars.push(
      [`--font-${role}--family`, `"${font.family}", ${font.fallback}`],
      [`--font-${role}--style`, font.style],
      [`--font-${role}--weight`, font.weight.toString()],
    );
  }

  const sizes = new Map(Object.entries(presetFontSizes(settings)));
  const text = (id: string): string => String(setting(settings, id));
  for (const preset of TYPE_PRESETS) {
    const font = preset === 'paragraph' ? 'body' : text(`type_font_${preset}`);
    vars.push(
      [`--font-size--${preset}`, sizes.get(preset) ?? ''],
      [`--font-${preset}--size`, `var(--font-size--${preset})`],
      [`--font-${preset}--family`, `var(--font-${font}--family)`],
      [`--font-${preset}--style`, `var(--font-${font}--style)`],
      [`--font-${preset}--weight`, preset === 'paragraph' ? '400' : `var(--font-${font}--weight)`],
      [`--font-${preset}--line-height`, `var(--line-height--${text(`type_line_height_${preset}`)})`],
      [`--font-${preset}--case`, preset === 'paragraph' ? 'none' : text(`type_case_${preset}`)],
    );
    if (preset !== 'paragraph') vars.push([`--font-${preset}--letter-spacing`, `var(--letter-spacing--${text(`type_letter_spacing_${preset}`)})`]);
  }

  const px = (id: string): string => `${text(id)}px`;
  vars.push(
    ['--style-border-radius-pills', px('pills_border_radius')],
    ['--style-border-radius-inputs', px('inputs_border_radius')],
    ['--style-border-radius-buttons-primary', px('button_border_radius_primary')],
    ['--style-border-radius-buttons-secondary', px('button_border_radius_secondary')],
    ['--style-border-width-primary', px('primary_button_border_width')],
    ['--style-border-width-secondary', px('secondary_button_border_width')],
    ['--style-border-width-inputs', px('input_border_width')],
    ['--style-border-radius-popover', px('popover_border_radius')],
    ['--button-font-family-primary', `var(--font-${text('type_font_button_primary')}--family)`],
    ['--button-font-family-secondary', `var(--font-${text('type_font_button_secondary')}--family)`],
    ['--button-text-case-primary', text('button_text_case_primary')],
    ['--button-text-case-secondary', text('button_text_case_secondary')],
  );

  return `:root {\n${vars.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`;
}
