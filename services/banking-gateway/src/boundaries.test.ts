import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The mock must stay removable: production code may never import from ../mock. Deleting the mock folder then
// breaks nothing but the mock entry point and the mock-backed tests that live inside it.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('module boundaries', () => {
  it('nothing under src/ imports the mock', () => {
    const offenders = walk(join(import.meta.dirname, '.'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /from\s+['"][^'"]*\/mock\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
