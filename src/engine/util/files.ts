import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MEDIA_EXTENSIONS, type AssetKind } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import { longPath } from '../office/paths.js';

export interface SourceFile {
  relPath: string;
  absolutePath: string;
  bytes: number;
  kind: AssetKind;
  modifiedAt: Date;
}

const IGNORED_DIRS = new Set([
  'System Volume Information',
  '$RECYCLE.BIN',
  '.workspace-office',
  'node_modules',
  '.git',
]);

export async function walkMediaFiles(root: string, maxFiles = 100_000): Promise<SourceFile[]> {
  const absoluteRoot = resolve(root);
  const out: SourceFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 24 || out.length > maxFiles) return;
    const entries = await readdir(longPath(dir), { withFileTypes: true });
    for (const entry of entries) {
      if (out.length > maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      const kind = MEDIA_EXTENSIONS[extension];
      if (!kind) continue;
      const absolutePath = join(dir, entry.name);
      let size = 0;
      let modifiedAt = new Date();
      try {
        const stats = statSync(longPath(absolutePath));
        size = stats.size;
        modifiedAt = stats.mtime;
      } catch {
        continue;
      }
      const rel = relative(absoluteRoot, absolutePath).split(sep).join('/');
      out.push({ relPath: rel, absolutePath, bytes: size, kind, modifiedAt });
    }
  }

  await walk(absoluteRoot, 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(longPath(file))) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export interface CopyProgress {
  bytes: number;
}

/**
 * نسخ + هاش في مرور واحد. لا تُقبل النسخة إن فشل أي جزء منها.
 * إعادة المحاولة مرة واحدة، ثم WS-3002.
 */
export async function copyFileWithHash(
  source: string,
  destination: string,
  onProgress?: (progress: CopyProgress) => void,
): Promise<{ sha256: string; bytes: number }> {
  mkdirSync(dirname(destination), { recursive: true });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const sourceStats = statSync(longPath(source));
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          bytes += chunk.length;
          onProgress?.({ bytes });
          callback(null, chunk);
        },
      });
      await pipeline(
        createReadStream(longPath(source)),
        hasher,
        createWriteStream(longPath(destination)),
      );
      utimesSync(longPath(destination), new Date(), sourceStats.mtime);
      return { sha256: hash.digest('hex'), bytes };
    } catch (error) {
      lastError = error;
      try {
        if (existsSync(longPath(destination))) unlinkSync(longPath(destination));
      } catch {
        // تجاهل.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new AppError('WS-3002', { source, attempts: 2 }, lastError);
}

export function assertSameContentSize(source: string, destination: string): void {
  const sourceSize = statSync(longPath(source)).size;
  const destinationSize = statSync(longPath(destination)).size;
  if (sourceSize !== destinationSize) {
    throw new AppError('WS-3003', { sourceSize, destinationSize });
  }
}
