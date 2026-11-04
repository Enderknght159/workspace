import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { APP_SCHEMA } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { OfficePaths } from './paths.js';

export const officeConfigSchema = z.object({
  schema: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
});

export type OfficeConfig = z.infer<typeof officeConfigSchema>;

export function loadOrCreateOfficeConfig(
  paths: OfficePaths,
  fallbackName: string,
): { config: OfficeConfig; created: boolean } {
  if (existsSync(paths.officeFile)) {
    try {
      const raw = JSON.parse(readFileSync(paths.officeFile, 'utf8')) as unknown;
      return { config: officeConfigSchema.parse(raw), created: false };
    } catch (error) {
      throw new AppError('WS-1001', { file: paths.officeFile }, error);
    }
  }
  const config: OfficeConfig = {
    schema: APP_SCHEMA,
    id: newId('off'),
    name: fallbackName,
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(paths.officeFile, config);
  return { config, created: true };
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

export function writeTextAtomic(file: string, value: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, value, 'utf8');
  renameSync(tmp, file);
}

export function officeNameFile(paths: OfficePaths): string {
  return join(paths.root, 'office.json');
}
