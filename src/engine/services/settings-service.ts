import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import {
  DEFAULT_SETTINGS,
  officeSettingsSchema,
  type OfficeSettings,
  type SettingsPatchRequest,
} from '../../shared/schemas.js';
import type { Database } from '../db/database.js';
import type { AuditService } from './audit-service.js';
import type { Logger } from '../util/logger.js';
import { deepMerge } from '../util/misc.js';

const SETTINGS_KEY = 'office.settings';

export type SettingsPatchInput =
  | SettingsPatchRequest
  | { security?: Partial<OfficeSettings['security']> };

export class SettingsService {
  private cache: OfficeSettings | null = null;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  get(): OfficeSettings {
    if (this.cache) return this.cache;
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', SETTINGS_KEY);
    if (!row) {
      this.save(DEFAULT_SETTINGS);
      this.cache = DEFAULT_SETTINGS;
      return this.cache;
    }
    try {
      const parsed = officeSettingsSchema.parse(deepMerge(DEFAULT_SETTINGS, JSON.parse(row.value)));
      this.cache = parsed;
      return parsed;
    } catch (error) {
      this.logger.error('settings.invalid', { error: String(error) });
      this.cache = DEFAULT_SETTINGS;
      return this.cache;
    }
  }

  update(patch: SettingsPatchInput, actorId: string | null): OfficeSettings {
    const before = this.get();
    const merged = deepMerge(before, patch);
    const parsed = officeSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new AppError('WS-0003', { issues: parsed.error.issues });
    }
    this.save(parsed.data);
    this.cache = parsed.data;
    this.audit.record({
      actorId,
      action: 'settings.update',
      entity: 'settings',
      entityId: SETTINGS_KEY,
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  reset(actorId: string | null): OfficeSettings {
    const before = this.get();
    this.save(DEFAULT_SETTINGS);
    this.cache = DEFAULT_SETTINGS;
    this.audit.record({
      actorId,
      action: 'settings.reset',
      entity: 'settings',
      entityId: SETTINGS_KEY,
      before,
      after: DEFAULT_SETTINGS,
    });
    return this.cache;
  }

  private save(settings: OfficeSettings): void {
    const validated = officeSettingsSchema.parse(settings);
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      SETTINGS_KEY,
      JSON.stringify(validated),
      new Date().toISOString(),
    );
  }
}

export function settingsSchemaForDocs(): z.ZodType<OfficeSettings> {
  return officeSettingsSchema;
}
