import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import { Office } from '../office/office.js';
import { createLogger } from '../util/logger.js';
import { makeTempDir, withOffice } from '../testing/harness.js';
import { UNKNOWN_IDENTITY } from '../services/volume-identity.js';

describe('event service', () => {
  it('creates an event, writes the folder and manifest, and audits it', async () => {
    await withOffice(({ office, volumeRoot }) => {
      const volume = office.volumes.register(
        { root: volumeRoot, label: 'Hot', kind: 'hot' },
        'usr_local',
        office.config.id,
      );
      expect(volume.status).toBe('connected');

      const event = office.events.create(
        {
          kind: 'lesson',
          title: 'درس بر الوالدين',
          occurredAt: '2026-11-04',
          slug: 'abu-bakr',
        },
        'usr_local',
      );

      expect(event.state).toBe('draft');
      expect(event.relPath).toBe('10_events/2026/11/20261104_lesson_abu-bakr');
      const dir = join(volumeRoot, '10_events', '2026', '11', '20261104_lesson_abu-bakr');
      for (const child of ['source', 'work', 'output', 'review']) {
        expect(existsSync(join(dir, child))).toBe(true);
      }
      expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
      const manifest = event.manifest as { event_id?: string } | null;
      expect(manifest?.event_id).toBe(event.id);

      const ingested = office.events.transition(event.id, 'ingested', { actorId: 'usr_local' });
      expect(ingested.state).toBe('ingested');

      let failure: unknown;
      try {
        office.events.transition(event.id, 'published', { actorId: 'usr_local' });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AppError);
      expect((failure as AppError).code).toBe('WS-4001');

      const audit = office.audit.list({ entity: 'event', entityId: event.id });
      expect(audit.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['event.create', 'event.transition']),
      );
    });
  });

  it('lists and filters events', async () => {
    await withOffice(({ office, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      office.events.create({ kind: 'khutbah', title: 'خطبة الجمعة', occurredAt: '2026-10-30' }, null);
      office.events.create({ kind: 'lesson', title: 'درس التوحيد', occurredAt: '2026-11-01' }, null);

      const page = office.events.list({ limit: 10, offset: 0 });
      expect(page.total).toBe(2);
      expect(page.items[0]?.title).toBe('درس التوحيد');

      const filtered = office.events.list({ q: 'خطبة', limit: 10, offset: 0 });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.title).toBe('خطبة الجمعة');
    });
  });

  it('persists events across reopen', () => {
    const root = makeTempDir();
    const officeDir = join(root, 'office');
    const volumeRoot = join(root, 'volume');
    mkdirSync(volumeRoot, { recursive: true });
    const first = Office.open({
      dir: officeDir,
      volumeProbe: () => UNKNOWN_IDENTITY,
      logger: createLogger({ level: 'error' }),
    });
    const volume = first.volumes.register(
      { root: volumeRoot, label: 'Hot', kind: 'hot' },
      null,
      first.config.id,
    );
    const event = first.events.create(
      { kind: 'lesson', title: 'درس دائم', occurredAt: '2026-11-03' },
      null,
    );
    expect(volume.id).toBeTruthy();
    first.close();

    const second = Office.open({
      dir: officeDir,
      volumeProbe: () => UNKNOWN_IDENTITY,
      logger: createLogger({ level: 'error' }),
    });
    expect(second.events.get(event.id).title).toBe('درس دائم');
    expect(second.volumes.list()).toHaveLength(1);
    second.close();
  });
});
