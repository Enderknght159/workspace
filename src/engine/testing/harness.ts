import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Office } from '../office/office.js';
import { UNKNOWN_IDENTITY, type PhysicalIdentity } from '../services/volume-identity.js';
import { createLogger } from '../util/logger.js';

export function makeTempDir(prefix = 'workspace-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface TestOffice {
  office: Office;
  root: string;
  volumeRoot: string;
}

export async function withOffice(
  fn: (ctx: TestOffice) => void | Promise<void>,
  options: { probe?: (root: string) => PhysicalIdentity } = {},
): Promise<void> {
  const root = makeTempDir();
  const volumeRoot = join(root, 'volume');
  mkdirSync(volumeRoot, { recursive: true });
  const office = Office.open({
    dir: join(root, 'office'),
    volumeProbe: options.probe ?? (() => UNKNOWN_IDENTITY),
    logger: createLogger({ level: 'error' }),
  });
  try {
    await fn({ office, root, volumeRoot });
  } finally {
    office.close();
    rmSync(root, { recursive: true, force: true });
  }
}
