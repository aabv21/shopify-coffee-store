import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const yaml = readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow', () => {
  it('release runs only for a release: PR merged from develop or a release/ branch', () => {
    expect(yaml).toContain(
      "    if: github.event.pull_request.merged && startsWith(github.event.pull_request.title, 'release:') && (github.event.pull_request.head.ref == 'develop' || startsWith(github.event.pull_request.head.ref, 'release/'))\n",
    );
  });

  it('the release job keeps contents: write at job level only', () => {
    const top = /^permissions:\n {2}contents: read\n/m;
    expect(yaml).toMatch(top);
    expect(yaml.match(/contents: write/g)).toHaveLength(1);
    expect(yaml.indexOf('contents: write')).toBeGreaterThan(yaml.indexOf('jobs:'));
  });
});
