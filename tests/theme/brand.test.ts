import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyInsertion, BRAND_PALETTE, BRAND_SETTINGS, INSERTIONS, InsertionError, type SettingChange } from '../../scripts/lib/theme-insertions.ts';
import { blend, contrastRatio, hoverShift, parseFontHandle, parseHex } from '../../scripts/lib/theme-preview.ts';

const COMMENT = '/*\n * auto-generated\n */';
const theme = (current: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'nbc-brand-'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config/settings_schema.json'), JSON.stringify([
    { name: 'theme_info' },
    { name: 'colors', settings: [{ type: 'color_palette', id: 'color_palette', default: {} }] },
    { name: 'type', settings: [{ type: 'font_picker', id: 'type_body_font', default: 'work_sans_n4' }, { type: 'color', id: 'palette_primary_button_background' }] },
  ]));
  writeFileSync(join(dir, 'config/settings_data.json'), `${COMMENT}\n${JSON.stringify({ current, presets: { Default: { type_body_font: 'inter_n4' } } }, null, 2)}\n`);
  return dir;
};
const read = (dir: string) => {
  const text = readFileSync(join(dir, 'config/settings_data.json'), 'utf8');
  return { text, data: JSON.parse(text.slice(text.indexOf('{'))) as { current: Record<string, unknown>; presets: unknown } };
};
const set = (changes: SettingChange[]) => ({ kind: 'set-theme-settings', file: 'config/settings_data.json', changes }) as const;

describe('set-theme-settings', () => {
  it('changes the anchored settings, adds unset ones, and keeps the leading comment and presets', () => {
    const dir = theme({ type_body_font: 'inter_n4', color_palette: { background: '#ffffff' } });
    applyInsertion(dir, set([
      { id: 'type_body_font', from: 'inter_n4', to: 'alegreya_sans_n4' },
      { id: 'color_palette', from: { background: '#ffffff' }, to: { background: '#FBF7F2' } },
      { id: 'palette_primary_button_background', to: '{{ settings.color_palette.color1 }}' },
    ]));
    const { text, data } = read(dir);
    expect(text.startsWith(COMMENT)).toBe(true);
    expect(data.current).toEqual({ type_body_font: 'alegreya_sans_n4', color_palette: { background: '#FBF7F2' }, palette_primary_button_background: '{{ settings.color_palette.color1 }}' });
    expect(data.presets).toEqual({ Default: { type_body_font: 'inter_n4' } });
  });
  it("fails loudly when Horizon's current value is not the anchor", () =>
    expect(() => applyInsertion(theme({ type_body_font: 'work_sans_n4' }), set([{ id: 'type_body_font', from: 'inter_n4', to: 'alegreya_sans_n4' }])))
      .toThrow(/type_body_font is "work_sans_n4", expected "inter_n4"/));
  it('fails loudly when a setting expected to be unset already has a value', () =>
    expect(() => applyInsertion(theme({ palette_primary_button_background: '#000000' }), set([{ id: 'palette_primary_button_background', to: '#7C2D12' }])))
      .toThrow(/already set/));
  it('fails loudly on a setting the schema no longer declares', () =>
    expect(() => applyInsertion(theme({}), set([{ id: 'type_heading_font', to: 'alegreya_n5' }]))).toThrow(InsertionError));
});

describe('replace-anchor', () => {
  const css = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'nbc-replace-'));
    writeFileSync(join(dir, 'vars.liquid'), text);
    return dir;
  };
  const replace = { kind: 'replace-anchor', file: 'vars.liquid', anchor: '--opacity-muted-text: 0.6;', content: '--opacity-muted-text: 0.65;' } as const;
  it('replaces the one anchor, leaving the rest untouched', () => {
    const dir = css('  --opacity-subdued-text: 0.8;\n  --opacity-muted-text: 0.6;\n');
    applyInsertion(dir, replace);
    expect(readFileSync(join(dir, 'vars.liquid'), 'utf8')).toBe('  --opacity-subdued-text: 0.8;\n  --opacity-muted-text: 0.65;\n');
  });
  it('fails loudly on a missing or repeated anchor', () => {
    expect(() => applyInsertion(css('--opacity-muted-text: 0.5;'), replace)).toThrow(/anchor not found/);
    expect(() => applyInsertion(css('--opacity-muted-text: 0.6;--opacity-muted-text: 0.6;'), replace)).toThrow(/anchor appears 2 times/);
  });
});

describe('the brand', () => {
  const c = Object.fromEntries(Object.entries(BRAND_PALETTE).map(([k, v]) => [k, parseHex(v)])) as Record<keyof typeof BRAND_PALETTE, ReturnType<typeof parseHex>>;
  const muted = Number(/--opacity-muted-text: ([\d.]+);/.exec(INSERTIONS.flatMap((i) => (i.kind === 'replace-anchor' ? [i.content] : [])).join(''))?.[1]);

  // Every text and control pair the brand produces through Horizon's settings, at WCAG AA.
  it.each([
    ['body text: espresso on cream', c.foreground, c.background, 4.5],
    ['secondary text: muted on cream', c.color3, c.background, 4.5],
    ["Horizon's muted text: espresso at --opacity-muted-text on cream", blend(c.foreground, c.background, muted), c.background, 4.5],
    ["Horizon's subdued text: espresso at 80% on cream", blend(c.foreground, c.background, 0.8), c.background, 4.5],
    ['primary button: cream on roast', c.background, c.color1, 4.5],
    ['primary button hover: cream on the shifted roast', c.background, hoverShift(c.color1), 4.5],
    ['sold-out badge: espresso on sand', c.foreground, c.color2, 4.5],
    ['small badge: cream on leaf', c.background, c.color4, 4.5],
    ['control border: muted on cream', c.color3, c.background, 3],
    ['selected option and progress fill: roast on cream', c.color1, c.background, 3],
    ['progress fill against its track: roast on espresso at 10%', c.color1, blend(c.foreground, c.background, 0.1), 3],
  ])('%s meets %#', (_name, foreground, background, minimum) => expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum));

  it('raises muted text only as far as AA needs', () => {
    expect(contrastRatio(blend(c.foreground, c.background, 0.6), c.background)).toBeLessThan(4.5);
    expect(muted).toBe(0.65);
  });

  it('uses fonts the preview can load, a serif for headings and a sans for body text', () => {
    const font = (id: string) => parseFontHandle(BRAND_SETTINGS.find((change) => change.id === id)?.to);
    expect(font('type_heading_font').fallback).toBe('serif');
    expect(font('type_accent_font').fallback).toBe('serif');
    expect(font('type_body_font').fallback).toBe('sans-serif');
    expect(font('type_subheading_font').fallback).toBe('sans-serif');
  });
});
