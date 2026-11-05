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

export interface MountedDrive extends PhysicalIdentity {
  root: string;
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

/** هل المصدر على قرص قابل للإزالة (بطاقة/USB)؟ يحدد وضع النقل الافتراضي. */
export function isRemovableSource(source: string): boolean {
  if (process.platform !== 'win32') return false;
  const qualifier = /^[a-zA-Z]:/.exec(source)?.[0];
  if (!qualifier) return false;
  const script = [
    `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${qualifier}'" -ErrorAction Stop`,
    'if ($d) { $d.DriveType } else { 3 }',
  ].join('\n');
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 6000, windowsHide: true, encoding: 'utf8' },
    ).trim();
    return Number(output) === 2;
  } catch {
    return false;
  }
}

/**
 * تعداد كل الأقراص الموصولة على ويندوز لاكتشاف تغيّر حرف القرص.
 * تُستخدم عند «إعادة فحص» فقط، لا في كل فتح.
 */
export function listMountedDrives(timeoutMs = 10_000): MountedDrive[] {  if (process.platform !== 'win32') return [];
  const script = [
    'Get-Volume | Where-Object { $_.DriveLetter } |',
    'Select-Object DriveLetter,UniqueId,SerialNumber,FileSystem,Size |',
    'ConvertTo-Json -Compress',
  ].join(' ');
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
    ).trim();
    if (!output) return [];
    const parsed = JSON.parse(output) as
      | { DriveLetter?: string; UniqueId?: string; SerialNumber?: string; FileSystem?: string; Size?: number }
      | Array<{ DriveLetter?: string; UniqueId?: string; SerialNumber?: string; FileSystem?: string; Size?: number }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((row) => typeof row.DriveLetter === 'string' && row.DriveLetter.length > 0)
      .map((row) => ({
        root: `${row.DriveLetter}:\\`,
        volumeGuid: row.UniqueId?.trim() ? row.UniqueId.trim() : null,
        serial: row.SerialNumber?.trim() ? row.SerialNumber.trim() : null,
        fsType: row.FileSystem?.trim() ? row.FileSystem.trim() : null,
        sizeBytes: typeof row.Size === 'number' && row.Size > 0 ? row.Size : null,
      }));
  } catch {
    return [];
  }
}
