// Color math for the offline preview, following Horizon's Liquid color filters.

export interface Rgb { r: number; g: number; b: number }

export function parseHex(value: unknown): Rgb {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new Error(`expected a #rgb or #rrggbb color, got ${JSON.stringify(value)}`);
  }
  const hex = value.length === 4 ? value.slice(1).replace(/./g, (c) => c + c) : value.slice(1);
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export const channels = ({ r, g, b }: Rgb): string => `${r.toString()} ${g.toString()} ${b.toString()}`;

/** Shopify's `color_brightness`: perceived brightness, 0–255. */
export function brightness({ r, g, b }: Rgb): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `foreground` at `alpha` opacity over `background`, as the eye sees it. */
export function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  const mix = (f: number, b: number): number => Math.round(f * alpha + b * (1 - alpha));
  return { r: mix(foreground.r, background.r), g: mix(foreground.g, background.g), b: mix(foreground.b, background.b) };
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to255 = (v: number): number => Math.round((v + m) * 255);
  return { r: to255(r1), g: to255(g1), b: to255(b1) };
}

/** Shopify's `color_lighten` / `color_darken`: moves HSL lightness by `amount` percentage points. */
export function shiftLightness(color: Rgb, amount: number): Rgb {
  const hsl = toHsl(color);
  return fromHsl({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + amount / 100)) });
}

/** Horizon's `util-palette-hover-shift` for an opaque color. */
export function hoverShift(color: Rgb): Rgb {
  const b = brightness(color);
  if (b <= 40) return shiftLightness(color, 15);
  if (b <= 128) return shiftLightness(color, 5);
  if (b <= 190) return shiftLightness(color, -10);
  return shiftLightness(color, -5);
}
