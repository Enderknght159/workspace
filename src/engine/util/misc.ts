import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** معرّف جهاز ثابت نسبيًا، لا يحتوي بيانات شخصية. */
export function machineId(): string {
  const seed = `${hostname()}|${process.platform}|${process.arch}`;
  return `mch_${sha256Hex(seed).slice(0, 12)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(patch)) return base;
  if (!isRecord(base)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    if (isRecord(current) && isRecord(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
