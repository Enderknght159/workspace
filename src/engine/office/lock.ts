import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';

/**
 * قفل نسخة واحدة لكل مكتب. يعتمد على PID، ويُصلح القفل اليتيم بعد انقطاع.
 */
export class OfficeLock {
  private held = false;

  constructor(private readonly file: string) {}

  acquire(): void {
    if (this.held) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.file, 'wx');
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        closeSync(fd);
        this.held = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const owner = this.readOwner();
        if (owner && isProcessAlive(owner.pid)) {
          throw new AppError('WS-1002', { pid: owner.pid });
        }
        try {
          unlinkSync(this.file);
        } catch {
          // قد تكون أُزيلت للتو.
        }
      }
    }
    throw new AppError('WS-1002');
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      const owner = this.readOwner();
      if (owner?.pid === process.pid) unlinkSync(this.file);
    } catch {
      // لا نُفشل الإغلاق بسبب قفل مفقود.
    }
  }

  private readOwner(): { pid: number } | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { pid?: number };
      return typeof raw.pid === 'number' ? { pid: raw.pid } : null;
    } catch {
      return null;
    }
  }
}

export function lockFileFor(locksDir: string): string {
  return join(locksDir, 'office.lock');
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function lockExists(locksDir: string): boolean {
  return existsSync(lockFileFor(locksDir));
}
