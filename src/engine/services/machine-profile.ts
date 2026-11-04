import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { z } from 'zod';
import type { DoctorReport } from '../../shared/models.js';
import type { OfficePaths } from '../office/paths.js';
import { writeJsonAtomic } from '../office/config.js';

export const machineProfileFileSchema = z.object({
  schema: z.literal(1),
  volumeMounts: z.record(z.string(), z.string()),
  doctor: z
    .object({
      ok: z.boolean(),
      checkedAt: z.string(),
      machineId: z.string(),
      platform: z.string(),
      arch: z.string(),
      cpus: z.number(),
      totalMemoryGb: z.number(),
      tools: z.array(z.unknown()),
    })
    .nullable()
    .optional(),
});

export type MachineProfileFile = z.infer<typeof machineProfileFileSchema>;

const EMPTY: MachineProfileFile = { schema: 1, volumeMounts: {}, doctor: null };

/** ملف خاص بالجهاز، لا يدخل قاعدة البيانات ولا النسخ الاحتياطية المحمولة. */
export class MachineProfileStore {
  private cache: MachineProfileFile | null = null;

  constructor(private readonly paths: OfficePaths) {}

  load(): MachineProfileFile {
    if (this.cache) return this.cache;
    if (!existsSync(this.paths.profileFile)) {
      this.cache = { ...EMPTY, volumeMounts: {} };
      return this.cache;
    }
    try {
      const parsed = machineProfileFileSchema.parse(
        JSON.parse(readFileSync(this.paths.profileFile, 'utf8')),
      );
      this.cache = parsed;
      return parsed;
    } catch {
      this.cache = { ...EMPTY, volumeMounts: {} };
      return this.cache;
    }
  }

  save(profile: MachineProfileFile): void {
    this.cache = profile;
    writeJsonAtomic(this.paths.profileFile, profile);
  }

  mountOf(volumeId: string): string | null {
    return this.load().volumeMounts[volumeId] ?? null;
  }

  setMount(volumeId: string, root: string): void {
    const profile = this.load();
    profile.volumeMounts[volumeId] = root;
    this.save(profile);
  }

  setDoctor(report: DoctorReport): void {
    const profile = this.load();
    profile.doctor = report;
    this.save(profile);
  }

  doctor(): DoctorReport | null {
    const doctor = this.load().doctor;
    return doctor ? (doctor as unknown as DoctorReport) : null;
  }
}

export function freeBytesAt(root: string): number | null {
  try {
    const stats = statfsSync(root);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}
