import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { listJsonFiles } from '../../scripts/lib/list-json-files.ts';

/** The `{{ … }}` segments of an n8n expression string, or an error naming what is unterminated. */
function expressionSegments(value: string): { segments: string[]; error: string | null } {
  const segments: string[] = [];
  let at = value.indexOf('{{');
  while (at !== -1) {
    let depth = 0;
    let quote = '';
    let end = -1;
    for (let i = at + 2; i < value.length; i++) {
      const char = value.charAt(i);
      if (quote !== '') {
        if (char === '\\') i++;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && depth > 0) depth--;
      else if (char === '}' && value.charAt(i + 1) === '}') {
        end = i;
        break;
      }
    }
    if (end === -1) return { segments, error: quote === '' ? 'a {{ is never closed' : `a ${quote} string is never closed` };
    segments.push(value.slice(at + 2, end));
    at = value.indexOf('{{', end + 2);
  }
  return { segments, error: null };
}

/** `null` when the segment is valid JavaScript as an expression. */
function compileError(segment: string): string | null {
  try {
    new Script(`(${segment}\n)`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Every problem in one expression string: an unterminated segment or a segment that does not compile. */
function problemsIn(text: string): string[] {
  const { segments, error } = expressionSegments(text);
  const problems = error === null ? [] : [error];
  for (const segment of segments) {
    const failure = compileError(segment);
    if (failure !== null) problems.push(failure);
  }
  return problems;
}

function expressionStrings(value: unknown, path: string, found: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof value === 'string' && value.startsWith('=') && value.includes('{{')) found.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, i) => expressionStrings(item, `${path}[${String(i)}]`, found));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) expressionStrings(item, `${path}.${key}`, found);
  return found;
}

describe('every n8n expression compiles', () => {
  let total = 0;
  for (const file of listJsonFiles('workflows')) {
    it(basename(file), () => {
      const workflow = JSON.parse(readFileSync(file, 'utf8')) as { nodes: { name: string; parameters: unknown }[] };
      const problems: string[] = [];
      let checked = 0;
      for (const node of workflow.nodes) {
        for (const { path, text } of expressionStrings(node.parameters, node.name)) {
          checked += expressionSegments(text).segments.length;
          problems.push(...problemsIn(text).map((problem) => `${path}: ${problem}`));
        }
      }
      expect(problems).toEqual([]);
      total += checked;
    });
  }

  it('found expressions to check, so an empty scan cannot pass', () => {
    expect(total).toBeGreaterThan(0);
  });

  describe('self-test', () => {
    it('rejects an apostrophe inside a single-quoted string', () => {
      expect(problemsIn("={{ 'it's' }}")).not.toEqual([]);
      expect(problemsIn("={{ 'it\\'s' }}")).toEqual([]);
    });

    it('checks every segment of a multi-segment string', () => {
      expect(expressionSegments('=Hi {{ $json.name }}, order {{ $json.id }}').segments).toEqual([' $json.name ', ' $json.id ']);
      expect(problemsIn('=Hi {{ $json.name }}, order {{ $json.id }}')).toEqual([]);
      expect(problemsIn("=Hi {{ $json.name }}, order {{ 'it's' }}")).not.toEqual([]);
    });

    it('accepts a $fromAI argument and rejects a broken one', () => {
      expect(problemsIn("={{ $fromAI('subject', 'The email subject', 'string') }}")).toEqual([]);
      expect(problemsIn("={{ $fromAI('subject', 'The customer's subject', 'string') }}")).not.toEqual([]);
    });

    it('rejects a JSON-template body with a missing comma', () => {
      expect(problemsIn('={{ { a: 1, b: $json.x } }}')).toEqual([]);
      expect(problemsIn('={{ { a: 1 b: $json.x } }}')).not.toEqual([]);
    });

    it('reports an unclosed segment', () => {
      expect(problemsIn('={{ $json.a ')).toEqual(['a {{ is never closed']);
    });
  });
});
