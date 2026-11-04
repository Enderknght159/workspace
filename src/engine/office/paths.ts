import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { normalizeRel } from '../../shared/paths.js';

export class OfficePaths {
  readonly dataDir: string;
  readonly dbFile: string;
  readonly logsDir: string;
  readonly backupsDir: string;
  readonly stylesDir: string;
  readonly locksDir: string;
  readonly cacheDir: string;
  readonly profileFile: string;
  readonly officeFile: string;

  constructor(readonly root: string) {
    this.officeFile = join(root, 'office.json');
    this.dataDir = join(root, 'data');
    this.dbFile = join(this.dataDir, 'workspace.db');
    this.logsDir = join(root, 'logs');
    this.backupsDir = join(root, 'backups');
    this.stylesDir = join(root, 'styles');
    this.locksDir = join(root, 'locks');
    this.cacheDir = join(root, 'cache');
    this.profileFile = join(root, 'machine_profile.json');
  }

  ensureDirs(): void {
    for (const dir of [
      this.root,
      this.dataDir,
      this.logsDir,
      this.backupsDir,
      this.stylesDir,
      this.locksDir,
      this.cacheDir,
    ]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** يمنع الخروج من جذر القرص بأي حال. */
  resolveInside(volumeRoot: string, relPath: string): string {
    const rel = normalizeRel(relPath);
    const root = resolve(volumeRoot);
    const absolute = resolve(root, ...rel.split('/'));
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (absolute !== root && !absolute.startsWith(prefix)) {
      throw new Error(`path escapes volume root: ${relPath}`);
    }
    return absolute;
  }

  toRelative(volumeRoot: string, absolutePath: string): string {
    const rel = relative(resolve(volumeRoot), resolve(absolutePath));
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path outside volume');
    return normalizeRel(rel.split(sep).join('/'));
  }

  get hasStyles(): boolean {
    return true;
  }
}

/** بادئة المسار الطويل على ويندوز (حد 260 حرفًا). */
export function longPath(absolutePath: string): string {
  if (process.platform !== 'win32') return absolutePath;
  if (absolutePath.startsWith('\\\\?\\')) return absolutePath;
  const resolved = resolve(absolutePath);
  if (resolved.length < 240) return resolved;
  if (resolved.startsWith('\\\\')) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}
