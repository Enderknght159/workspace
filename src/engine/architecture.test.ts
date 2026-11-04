import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('architecture boundaries', () => {
  it('engine and shared never import electron', () => {
    const offenders: string[] = [];
    for (const file of [...filesUnder(join(ROOT, 'engine')), ...filesUnder(join(ROOT, 'shared'))]) {
      const source = readFileSync(file, 'utf8');
      if (/from ['"]electron['"]|require\(['"]electron['"]\)/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('shared never imports node builtins', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(ROOT, 'shared'))) {
      const source = readFileSync(file, 'utf8');
      if (/from ['"]node:/.test(source) || /require\(['"]node:/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
