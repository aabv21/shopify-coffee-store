// Component CSS reads only Horizon's color variables, which the brand settings fill in, so a
// merchant's color scheme reaches every component and the brand test's contrast checks hold.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** CSS Color 4's named colors (https://www.w3.org/TR/css-color-4/#named-colors). */
const NAMED_COLORS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue',
  'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
  'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
] as const;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const NUMERIC_COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+.\d]/i;
// A whole CSS identifier: a name inside `--color-white` or `var(--red)` doesn't count.
const IDENTIFIER = /(?<![-\w])[a-z]+(?![-\w(])/gi;
const NAMED = new Set<string>(NAMED_COLORS);

const namesAColor = (value: string): boolean =>
  HEX.test(value) || NUMERIC_COLOR_FUNCTION.test(value) || [...value.matchAll(IDENTIFIER)].some((m) => NAMED.has(m[0].toLowerCase()));

/** Each `prop: value` declaration, custom properties included, whose value names a color of its own. */
function colorLiterals(css: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/(--[-\w]+|[-a-z]+)\s*:\s*([^;{}]+)/gi)) {
    const property = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (namesAColor(value)) found.push(`${property}: ${value}`);
  }
  return found;
}

const PAINT_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'lighting-color'];

/** The CSS a Liquid file carries: style blocks of every kind, style attributes, and SVG paint attributes. */
function cssOf(liquid: string): string {
  const parts: string[] = [];
  const blocks = [
    /\{%-?\s*stylesheet\s*-?%\}([\s\S]*?)\{%-?\s*endstylesheet\s*-?%\}/g,
    /\{%-?\s*style\s*-?%\}([\s\S]*?)\{%-?\s*endstyle\s*-?%\}/g,
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
  ];
  for (const block of blocks) for (const m of liquid.matchAll(block)) parts.push(m[1] ?? '');
  for (const m of liquid.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)) parts.push(m[1] ?? m[2] ?? '');
  for (const m of liquid.matchAll(/\s([-a-z]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    const attribute = m[1] ?? '';
    if (PAINT_ATTRIBUTES.includes(attribute)) parts.push(`${attribute}: ${m[2] ?? m[3] ?? ''};`);
  }
  return parts.join('\n');
}

const liquidFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return liquidFiles(path);
    return entry.name.endsWith('.liquid') ? [path] : [];
  });

describe('colorLiterals', () => {
  it('colorLiterals flags hex, numeric color functions and named colors', () =>
    expect(colorLiterals('a { color: #fff; background-color: rgb(12 34 56); border: 1px solid hsl(0 0% 0%); outline-color: white; }')).toEqual([
      'color: #fff',
      'background-color: rgb(12 34 56)',
      'border: 1px solid hsl(0 0% 0%)',
      'outline-color: white',
    ]));

  it.each([
    ['a named color outside the basic sixteen', 'a { color: crimson; }'],
    ['a compound named color', 'a { background: whitesmoke; }'],
    ['rebeccapurple', 'a { border-color: RebeccaPurple; }'],
    ['a named color in a custom property', '.x { --finder-accent: red; }'],
    ['a named color in a gradient', 'a { background-image: linear-gradient(tomato, var(--color-background)); }'],
  ])('colorLiterals flags %s', (_name, css) => expect(colorLiterals(css)).toHaveLength(1));

  it.each([
    'a { background-color: rgb(var(--color-foreground-rgb) / var(--opacity-5)); }',
    'a { background-color: color-mix(in srgb, var(--finder-accent) 8%, var(--color-input-background)); }',
    'a { stroke: currentColor; }',
    'a { fill: none; }',
    'a { background: transparent; }',
    'a { color: var(--color-white); border: var(--style-border-width) solid var(--red); }',
    'a { transition: transform var(--animation-speed-slow) var(--ease-out-cubic); font-weight: bold; }',
  ])('colorLiterals allows theme variables, currentColor, none and transparent: %s', (css) => expect(colorLiterals(css)).toEqual([]));
});

describe('cssOf', () => {
  it.each([
    ['a stylesheet block', '{% stylesheet %} .a { color: navy; } {% endstylesheet %}'],
    ['a style block', '{% style %} .a { color: navy; } {% endstyle %}'],
    ['a <style> element', '<style media="all"> .a { color: navy; } </style>'],
    ['a double-quoted style attribute', '<div style="color: navy"></div>'],
    ['a single-quoted style attribute', "<div style='color: navy'></div>"],
    ['an SVG fill', '<path fill="#7c2d12"/>'],
    ['a single-quoted SVG stroke', "<path stroke='navy'/>"],
    ['an SVG stop-color', '<stop offset="0" stop-color="navy"/>'],
    ['an SVG color attribute', '<svg color="navy"></svg>'],
  ])('finds the color in %s', (_name, liquid) => expect(colorLiterals(cssOf(liquid))).toHaveLength(1));

  it('ignores attributes that only end like a paint attribute', () =>
    expect(colorLiterals(cssOf('<div data-color="navy" data-fill="red"></div>'))).toEqual([]));
});

describe('theme files', () => {
  const files = liquidFiles('theme');
  it('finds the theme Liquid files', () => expect(files.length).toBeGreaterThan(0));
  it.each(files)('%s names no color of its own', (file) => expect(colorLiterals(cssOf(readFileSync(file, 'utf8')))).toEqual([]));
});
