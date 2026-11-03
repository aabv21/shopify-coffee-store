// Shopify's locale files are JSON with comments: Horizon's carry a leading `/* ... */` notice and
// `//` notes for translators. JSON.parse rejects both, so this blanks them out first.

/**
 * `source` with every `//` and `/* *\/` comment outside a string replaced by spaces (newlines
 * kept), so offsets and line numbers still point at the original text.
 */
export function stripJsonComments(source: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated comment');
      out += source.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

export function parseJsonc(source: string): unknown {
  return JSON.parse(stripJsonComments(source));
}
