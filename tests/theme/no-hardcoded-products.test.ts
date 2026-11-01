import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it.each(['theme/sections/coffee-finder.liquid', 'src/theme/recommend.ts', 'src/theme/coffee-finder.ts'])(
  '%s names no product; recommendations come from metafields',
  (f) => expect(readFileSync(f, 'utf8')).not.toMatch(/Nariño|Narino|Huila|Sierra Nevada/i));
