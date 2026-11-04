import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import { Office } from '../office/office.js';
import { createLogger } from '../util/logger.js';
import { makeTempDir, withOffice } from '../testing/harness.js';

describe('database bootstrap', () => {
  it('creates every v1 table and applies the migration once', async () => {
    await withOffice(({ office }) => {
      const tables = office.db
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .map((row) => row.name);

      for (const expected of [
        'office',
        'users',
        'settings',
        'volumes',
        'events',
        'assets',
        'placements',
        'jobs',
        'job_logs',
        'reviews',
        'publications',
        'styles',
        'recipes',
        'archive_moves',
        'ingest_batches',
        'ingest_files',
        'tasks',
        'audit_log',
        'schema_migrations',
      ]) {
        expect(tables).toContain(expected);
      }

      const migrations = office.db.all<{ version: number }>('SELECT version FROM schema_migrations');
      expect(migrations).toHaveLength(1);
      expect(migrations[0]?.version).toBe(1);
    });
  });

  it('persists settings and invalidates cache', async () => {
    await withOffice(({ office }) => {
      const defaults = office.settings.get();
      expect(defaults.office.name).toBe('مكتب الوسائط');
      expect(defaults.queue.concurrency).toBe(1);

      const updated = office.settings.update({ ui: { theme: 'light' } }, 'usr_local');
      expect(updated.ui.theme).toBe('light');
      expect(office.settings.get().ui.theme).toBe('light');

      const audit = office.audit.list({ entity: 'settings' });
      expect(audit.some((entry) => entry.action === 'settings.update')).toBe(true);
    });
  });

  it('rejects a second open on the same office and allows reopen after close', () => {
    const root = makeTempDir();
    const officeDir = `${root}/office`;
    const first = Office.open({
      dir: officeDir,
      volumeProbe: () => ({ volumeGuid: null, serial: null, fsType: null, sizeBytes: null }),
      logger: createLogger({ level: 'error' }),
    });
    expect(existsSync(`${officeDir}/data/workspace.db`)).toBe(true);

    let error: unknown;
    try {
      Office.open({ dir: officeDir, logger: createLogger({ level: 'error' }) });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('WS-1002');

    first.close();
    const second = Office.open({
      dir: officeDir,
      logger: createLogger({ level: 'error' }),
      volumeProbe: () => ({ volumeGuid: null, serial: null, fsType: null, sizeBytes: null }),
    });
    second.close();
  });
});
