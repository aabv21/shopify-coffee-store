import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * One theme setting to change in `settings_data.json`'s `current` values. With `from`, the
 * setting must currently hold exactly that value (the anchor); without it, the setting must not be
 * set yet, so the schema default is what's being replaced. Either way, `id` must be a setting
 * `settings_schema.json` declares.
 */
export interface SettingChange { id: string; from?: unknown; to: unknown }

export type Insertion =
  | { kind: 'before-line'; file: string; anchor: string; content: string }
  | { kind: 'replace-anchor'; file: string; anchor: string; content: string }
  | { kind: 'append-settings-group'; file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }
  | { kind: 'add-section-after'; file: string; after: string; key: string; section: { type: string; settings: Record<string, unknown> } }
  | { kind: 'set-theme-settings'; file: 'config/settings_data.json'; changes: readonly SettingChange[] };

export class InsertionError extends Error {}

// Nubandina's palette, in Horizon's own palette keys. color1-color3 keep the roles Horizon's
// settings_data.json gives them (a dark accent, a light tint for the sold-out badge, and the
// input and variant borders); color4 is new.
export const BRAND_PALETTE = {
  background: '#FBF7F2', // cream
  foreground: '#2B1B12', // espresso
  color1: '#7C2D12', // roast: primary buttons and selected variants
  color2: '#E7DCCD', // sand: decorative tints only
  color3: '#6B5B4E', // muted: control borders and secondary text
  color4: '#3F6212', // leaf: small badges only
} as const;

// Horizon v4.3.0's own `current` values that the brand replaces: the anchors that make a changed
// Horizon fail assembly instead of silently mixing two designs.
const HORIZON_PALETTE = { background: '#ffffff', foreground: '#000000', color1: '#333333', color2: '#EEF1EA', color3: '#DFDFDF' };

// Fonts from Shopify's font library, each handle checked against its published list: Alegreya
// (a calligraphic serif) for headings and accents, Alegreya Sans (its humanist sans companion)
// for body text and subheadings.
export const BRAND_SETTINGS: readonly SettingChange[] = [
  { id: 'color_palette', from: HORIZON_PALETTE, to: BRAND_PALETTE },
  { id: 'type_body_font', from: 'inter_n4', to: 'alegreya_sans_n4' },
  { id: 'type_subheading_font', from: 'inter_n5', to: 'alegreya_sans_n5' },
  { id: 'type_heading_font', from: 'inter_n7', to: 'alegreya_n5' },
  { id: 'type_accent_font', from: 'inter_n7', to: 'alegreya_n7' },
  // Alegreya Sans has a small x-height; 14px body text reads closer to 12px.
  { id: 'type_size_paragraph', from: '14', to: '16' },
  { id: 'palette_primary_button_background', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_primary_button_border', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_selected_variant_background', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_selected_variant_border', to: '{{ settings.color_palette.color1 }}' },
];

export const INSERTIONS: readonly Insertion[] = [
  {
    kind: 'before-line',
    file: 'snippets/cart-summary.liquid',
    anchor: '<div class="cart-totals">',
    content: "{% render 'free-shipping-bar' %}",
  },
  {
    kind: 'append-settings-group',
    file: 'config/settings_schema.json',
    group: {
      name: 'Free shipping bar',
      settings: [
        { type: 'checkbox', id: 'free_shipping_bar_enabled', label: 'Show the free shipping bar', default: true },
        {
          type: 'number',
          id: 'free_shipping_threshold',
          label: 'Free shipping threshold',
          default: 120000,
          info: 'Whole amount in the store currency. Match the free shipping rate in Settings > Shipping and delivery.',
        },
        {
          type: 'text',
          id: 'free_shipping_message_remaining',
          label: 'Message: amount remaining',
          default: 'You’re [amount] away from free shipping',
          info: '[amount] shows the amount left.',
        },
        {
          type: 'text',
          id: 'free_shipping_message_reached',
          label: 'Message: free shipping reached',
          default: 'You’ve got free shipping!',
        },
        {
          type: 'text',
          id: 'free_shipping_progress_label',
          label: 'Progress bar accessible label',
          default: 'Progress toward free shipping',
        },
      ],
    },
  },
  {
    kind: 'add-section-after',
    file: 'templates/index.json',
    after: 'hero_jVaWmY',
    key: 'coffee_finder',
    section: { type: 'coffee-finder', settings: {} },
  },
  { kind: 'set-theme-settings', file: 'config/settings_data.json', changes: BRAND_SETTINGS },
  {
    // Horizon's muted text is the foreground at 60% opacity: 4.32:1 on the cream background,
    // under WCAG AA's 4.5:1. At 65% it measures 5.06:1.
    kind: 'replace-anchor',
    file: 'snippets/theme-styles-variables.liquid',
    anchor: '--opacity-muted-text: 0.6;',
    content: '--opacity-muted-text: 0.65;',
  },
];

function readThemeFile(themeDir: string, file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  return readFileSync(join(themeDir, file), 'utf8');
}

function writeThemeFile(themeDir: string, file: string, content: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  writeFileSync(join(themeDir, file), content);
}

function readAnchored(themeDir: string, insertion: { file: string; anchor: string }): string {
  const text = readThemeFile(themeDir, insertion.file);
  const count = text.split(insertion.anchor).length - 1;
  if (count === 0) throw new InsertionError(`${insertion.file}: anchor not found: ${insertion.anchor}`);
  if (count > 1) throw new InsertionError(`${insertion.file}: anchor appears ${count.toString()} times: ${insertion.anchor}`);
  return text;
}

function applyBeforeLine(themeDir: string, insertion: { file: string; anchor: string; content: string }): void {
  const text = readAnchored(themeDir, insertion);
  writeThemeFile(themeDir, insertion.file, text.replace(insertion.anchor, `${insertion.content}\n${insertion.anchor}`));
}

function applyReplaceAnchor(themeDir: string, insertion: { file: string; anchor: string; content: string }): void {
  const text = readAnchored(themeDir, insertion);
  writeThemeFile(themeDir, insertion.file, text.replace(insertion.anchor, () => insertion.content));
}

function applyAppendSettingsGroup(themeDir: string, insertion: { file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }): void {
  const groups = JSON.parse(readThemeFile(themeDir, insertion.file)) as { name: string }[];
  if (groups.some((g) => g.name === insertion.group.name)) {
    throw new InsertionError(`${insertion.file}: settings group exists: ${insertion.group.name}`);
  }
  groups.push(insertion.group);
  writeThemeFile(themeDir, insertion.file, `${JSON.stringify(groups, null, 2)}\n`);
}

// A JSON template may start with a Shopify-generated `/* ... */` comment; this keeps it as the
// literal prefix instead of round-tripping through JSON.stringify, which would drop it.
export function splitLeadingComment(text: string): { comment: string; json: string } {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/*')) return { comment: '', json: text };
  const end = trimmed.indexOf('*/');
  if (end === -1) return { comment: '', json: text };
  const commentEnd = end + '*/'.length;
  return { comment: trimmed.slice(0, commentEnd), json: trimmed.slice(commentEnd) };
}

function applyAddSectionAfter(themeDir: string, insertion: { file: string; after: string; key: string; section: { type: string; settings: Record<string, unknown> } }): void {
  const raw = readThemeFile(themeDir, insertion.file);
  const { comment, json } = splitLeadingComment(raw);
  const parsed = JSON.parse(json) as { sections: Record<string, unknown>; order: string[] };

  if (!(insertion.after in parsed.sections)) throw new InsertionError(`${insertion.file}: section not found: ${insertion.after}`);
  if (insertion.key in parsed.sections) throw new InsertionError(`${insertion.file}: section exists: ${insertion.key}`);

  parsed.sections[insertion.key] = insertion.section;
  const index = parsed.order.indexOf(insertion.after);
  parsed.order.splice(index + 1, 0, insertion.key);

  const body = `${JSON.stringify(parsed, null, 2)}\n`;
  writeThemeFile(themeDir, insertion.file, comment ? `${comment}\n${body}` : body);
}

function schemaSettingIds(themeDir: string): Set<string> {
  const groups = JSON.parse(readThemeFile(themeDir, 'config/settings_schema.json')) as { settings?: { id?: unknown }[] }[];
  const ids = new Set<string>();
  for (const group of groups) {
    for (const setting of group.settings ?? []) if (typeof setting.id === 'string') ids.add(setting.id);
  }
  return ids;
}

function applySetThemeSettings(themeDir: string, insertion: { file: 'config/settings_data.json'; changes: readonly SettingChange[] }): void {
  const ids = schemaSettingIds(themeDir);
  const { comment, json } = splitLeadingComment(readThemeFile(themeDir, insertion.file));
  const data = JSON.parse(json) as { current?: unknown };
  const current = data.current;
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new InsertionError(`${insertion.file}: "current" is not an object of settings`);
  }
  const settings = current as Record<string, unknown>;

  for (const change of insertion.changes) {
    if (!ids.has(change.id)) throw new InsertionError(`${insertion.file}: settings_schema.json declares no setting ${change.id}`);
    if ('from' in change) {
      if (!isDeepStrictEqual(settings[change.id], change.from)) {
        throw new InsertionError(`${insertion.file}: ${change.id} is ${JSON.stringify(settings[change.id])}, expected ${JSON.stringify(change.from)}`);
      }
    } else if (change.id in settings) {
      throw new InsertionError(`${insertion.file}: ${change.id} is already set to ${JSON.stringify(settings[change.id])}`);
    }
    settings[change.id] = change.to;
  }

  const body = `${JSON.stringify(data, null, 2)}\n`;
  writeThemeFile(themeDir, insertion.file, comment ? `${comment}\n${body}` : body);
}

export function applyInsertion(themeDir: string, insertion: Insertion): void {
  switch (insertion.kind) {
    case 'before-line':
      applyBeforeLine(themeDir, insertion);
      return;
    case 'replace-anchor':
      applyReplaceAnchor(themeDir, insertion);
      return;
    case 'set-theme-settings':
      applySetThemeSettings(themeDir, insertion);
      return;
    case 'append-settings-group':
      applyAppendSettingsGroup(themeDir, insertion);
      return;
    case 'add-section-after':
      applyAddSectionAfter(themeDir, insertion);
      return;
  }
}
