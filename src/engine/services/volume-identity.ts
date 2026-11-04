import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REGISTRY_DIR, REGISTRY_FILE, VOLUME_KINDS } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import { writeJsonAtomic } from '../office/config.js';

export const volumeFingerprintSchema = z.object({
  schema: z.literal(1),
  volume_id: z.string().min(3),
  label: z.string().min(1),
  kind: z.enum(VOLUME_KINDS),
  created_at: z.string().min(1),
  offices: z.array(z.string()).optional(),
});

export type VolumeFingerprint = z.infer<typeof volumeFingerprintSchema>;

export interface PhysicalIdentity {
  volumeGuid: string | null;
  serial: string | null;
  fsType: string | null;
  sizeBytes: number | null;
}

export const UNKNOWN_IDENTITY: PhysicalIdentity = {
  volumeGuid: null,
  serial: null,
  fsType: null,
  sizeBytes: null,
};

export function registryDir(root: string): string {
  return join(root, REGISTRY_DIR);
}

export function fingerprintFile(root: string): string {
  return join(registryDir(root), REGISTRY_FILE);
}

export function readFingerprint(root: string): VolumeFingerprint | null {
  const file = fingerprintFile(root);
  if (!existsSync(file)) return null;
  try {
    return volumeFingerprintSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

export function writeFingerprint(
  root: string,
  config: { id: string; label: string; kind: (typeof VOLUME_KINDS)[number]; officeId: string },
): VolumeFingerprint {
  const dir = registryDir(root);
  mkdirSync(dir, { recursive: true });
  const existing = readFingerprint(root);
  const fingerprint: VolumeFingerprint = {
    schema: 1,
    volume_id: config.id,
    label: config.label,
    kind: config.kind,
    created_at: existing?.created_at ?? new Date().toISOString(),
    offices: Array.from(new Set([...(existing?.offices ?? []), config.officeId])),
  };
  writeJsonAtomic(fingerprintFile(root), fingerprint);
  hideRegistry(dir);
  return fingerprint;
}

export function hideRegistry(dir: string): void {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('attrib.exe', ['+h', '+s', dir], { windowsHide: true, timeout: 5000 });
  } catch {
    // الإخفاء تجميلي؛ لا يُفشل التسجيل.
  }
}

/**
 * الهوية الفيزيائية عبر PowerShell. تفشل بهدوء على الأنظمة غير المدعومة
 * (قرص شبكة، نظام غير ويندوز) ليظل التسجيل ممكنًا مع تحذير.
 */
export function probePhysicalIdentity(root: string, timeoutMs = 8000): PhysicalIdentity {
  if (process.platform !== 'win32' || !existsSync(root)) return UNKNOWN_IDENTITY;
  const escaped = root.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$root = '${escaped}'`,
    'try {',
    '  $v = Get-Volume -FilePath $root',
    "  $out = [pscustomobject]@{ uniqueId = [string]$v.UniqueId; serial = [string]$v.SerialNumber; fs = [string]$v.FileSystem; size = [int64]$v.Size }",
    '} catch {',
    '  $qualifier = Split-Path -Qualifier $root',
    '  $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'$qualifier\'" -ErrorAction Stop',
    "  $out = [pscustomobject]@{ uniqueId = ''; serial = [string]$d.VolumeSerialNumber; fs = [string]$d.FileSystem; size = [int64]$d.Size }",
    '}',
    '$out | ConvertTo-Json -Compress',
  ].join('\n');

  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
    ).trim();
    const parsed = JSON.parse(output) as {
      uniqueId?: string;
      serial?: string;
      fs?: string;
      size?: number;
    };
    return {
      volumeGuid: parsed.uniqueId?.trim() ? parsed.uniqueId.trim() : null,
      serial: parsed.serial?.trim() ? parsed.serial.trim() : null,
      fsType: parsed.fs?.trim() ? parsed.fs.trim() : null,
      sizeBytes: typeof parsed.size === 'number' && parsed.size > 0 ? parsed.size : null,
    };
  } catch {
    return UNKNOWN_IDENTITY;
  }
}

export function assertVolumeRoot(root: string): void {
  if (!existsSync(root)) throw new AppError('WS-2002', { root });
  const fingerprint = readFingerprint(root);
  if (fingerprint) return;
  mkdirSync(root, { recursive: true });
}
