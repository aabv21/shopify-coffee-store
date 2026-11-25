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

  it('README shows the Demo label above the diagram and promises no video', () => {
    const diagram = readme.findIndex((line) => line.includes('docs/diagrams/architecture.svg'));
    expect(diagram).toBeGreaterThan(0);
    expect(readme.indexOf('**Demo**')).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf('**Demo**')).toBeLessThan(diagram);
    expect(readme.some((line) => /\*\*Video:\*\*/.test(line))).toBe(false);
  });
});

describe('agent docs', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');

  it('AGENTS.md stays at 150 lines or fewer', () => expect(agents.trimEnd().split('\n').length).toBeLessThanOrEqual(150));

  it('AGENTS.md links every doc it hands procedures to', () => {
    for (const target of ['docs/operations.md', 'docs/i18n.md', 'docs/diagrams/README.md', 'docs/architecture.md#http-surface', 'CONTRIBUTING.md', 'theme/README.md']) {
      expect(agents, target).toContain(target);
    }
  });

  it('docs/architecture.md has an HTTP surface table naming every route and status', () => {
    const text = readFileSync('docs/architecture.md', 'utf8');
    const section = text.split('\n## ').find((s) => s.startsWith('HTTP surface')) ?? '';
    for (const token of ['/webhook/dev', '/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook', 'X-Dev-Token', 'X-Shopify-Hmac-Sha256', 'unknown_target', '403', '404', '429']) {
      expect(section, token).toContain(token);
    }
  });
});
