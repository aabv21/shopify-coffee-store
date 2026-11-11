// Prose names the n8n line, not the patch compose.yaml pins, so a Dependabot patch bump never
// makes the docs wrong. A patch appears only as the version a claim was checked against.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCS = ['README.md', 'AGENTS.md', 'theme/README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

/** Each `file:line: match` for a global pattern in the docs, unless `allowed` accepts the 30 characters before it. */
function offenders(pattern: RegExp, allowed: (before: string) => boolean = () => false): string[] {
  return DOCS.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(pattern)]
      .filter((m) => !allowed(text.slice(Math.max(0, m.index - 30), m.index)))
      .map((m) => `${file}:${String(text.slice(0, m.index).split('\n').length)}: ${m[0]}`);
  });
}

describe('version wording', () => {
  it('docs name an n8n patch only as the version a claim was checked against', () =>
    expect(offenders(/2\.45\.\d+/g, (before) => /(?:checked against|traced in)$/.test(before.replace(/[\s`]+/g, ' ').trimEnd().replace(/ n8n$/, '')))).toEqual([]));

  it('docs never pin a Redis version', () => expect(offenders(/Redis \d/g)).toEqual([]));
});

describe('README', () => {
  const readme = readFileSync('README.md', 'utf8').split('\n');

  it("README sections follow the design's order", () =>
    expect(readme.filter((line) => line.startsWith('## ')).map((line) => line.slice(3))).toEqual([
      'What it does',
      'Quick start',
      'Configuration',
      'Test scenarios',
      'Design decisions and production notes',
      'Limitations',
      'License',
    ]));

  it('README shows the Demo label and the video line above the diagram', () => {
    const diagram = readme.findIndex((line) => line.includes('docs/diagrams/architecture.svg'));
    expect(diagram).toBeGreaterThan(0);
    expect(readme.indexOf('**Demo**')).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf('**Demo**')).toBeLessThan(diagram);
    const video = readme.findIndex((line) => line.startsWith('**Video:**'));
    expect(video).toBeGreaterThanOrEqual(0);
    expect(video).toBeLessThan(diagram);
  });
});
