import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newId } from '../../shared/ids.js';
import { withOffice } from '../testing/harness.js';

describe('ingest selection and safe move', () => {
  it('ingests only the selected files and can split one card into two events', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'card');
      mkdirSync(source, { recursive: true });
      for (const name of ['a.mp4', 'b.mp4', 'c.mp4']) writeFileSync(join(source, name), name);

      const first = await office.ingest.preview({ source, selection: ['a.mp4'] });
      expect(first.selectedFiles).toBe(1);
      expect(first.totalFiles).toBe(3);
      await office.ingest.run(
        { source, selection: ['a.mp4'], title: 'الدرس الأول', slug: 'first', occurredAt: '2026-11-04' },
        null,
      );
      const second = await office.ingest.run(
        { source, selection: ['b.mp4', 'c.mp4'], title: 'الدرس الثاني', slug: 'second', occurredAt: '2026-11-04' },
        null,
      );

      const events = office.events.list({ limit: 10, offset: 0 });
      expect(events.total).toBe(2);
      const firstEvent = events.items.find((event) => event.slug === 'first')!;
      const secondEvent = events.items.find((event) => event.slug === 'second')!;
      expect(office.events.get(firstEvent.id).assets).toHaveLength(1);
      expect(office.events.get(secondEvent.id).assets).toHaveLength(2);
      expect(second.deletedSources).toBe(0);
    });
  });

  it('moves selected files from the source only after verification and can undo', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'card-move');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'move-me.mp4'), 'move-content');
      writeFileSync(join(source, 'keep-me.mp4'), 'keep-content');

      const batch = await office.ingest.run(
        {
          source,
          selection: ['move-me.mp4'],
          mode: 'move',
          title: 'حدث النقل',
          slug: 'move-test',
          occurredAt: '2026-11-04',
        },
        null,
      );

      expect(batch.mode).toBe('move');
      expect(batch.deletedSources).toBe(1);
      expect(existsSync(join(source, 'move-me.mp4'))).toBe(false);
      expect(existsSync(join(source, 'keep-me.mp4'))).toBe(true);

      const entry = office.moves.list()[0]!;
      expect(entry.action).toBe('ingest');
      expect(entry.state).toBe('completed');
      const undone = await office.moves.undo(entry.id, null);
      expect(undone.state).toBe('undone');
      expect(existsSync(join(source, 'move-me.mp4'))).toBe(true);
    });
  });
});

describe('asset relocation and raw cleanup', () => {
  it('moves an asset between events and keeps both manifests valid', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'relocate-source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'clip.mp4'), 'relocate-content');
      await office.ingest.run(
        { source, title: 'المصدر', slug: 'source-event', occurredAt: '2026-11-04' },
        null,
      );
      const events = office.events.list({ limit: 10, offset: 0 }).items;
      const sourceEvent = events.find((event) => event.slug === 'source-event')!;
      const targetEvent = office.events.create(
        { kind: 'lesson', title: 'الهدف', occurredAt: '2026-11-05', slug: 'target-event' },
        null,
      );
      const asset = office.events.get(sourceEvent.id).assets[0]!;
      const moved = await office.assets.relocate(asset.id, targetEvent.id, 'move', null);

      expect(moved.eventId).toBe(targetEvent.id);
      expect(office.events.get(sourceEvent.id).assets).toHaveLength(0);
      expect(office.events.get(targetEvent.id).assets).toHaveLength(1);
      expect(office.moves.latestForAsset(asset.id)?.action).toBe('relocate');
      const targetVolume = office.volumes.get(volumeRoot ? moved.volumeId : moved.volumeId)!;
      expect(existsSync(join(targetVolume.root!, ...moved.relPath.split('/')))).toBe(true);
    });
  });

  it('trashes raw sources only when a saved output exists', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'trash-source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'raw.mp4'), 'raw-content');
      await office.ingest.run(
        { source, title: 'حدث الحذف', slug: 'trash-event', occurredAt: '2026-11-04' },
        null,
      );
      const event = office.events.list({ limit: 10, offset: 0 }).items[0]!;

      expect(() => office.assets.trashSources(event.id, 'اسم خاطئ', null)).toThrowError(
        expect.objectContaining({ code: 'WS-0003' }),
      );
      expect(() => office.assets.trashSources(event.id, event.title, null)).toThrowError(
        expect.objectContaining({ code: 'WS-0006' }),
      );

      const jobId = newId('job');
      const now = new Date().toISOString();
      office.db.run(
        `INSERT INTO jobs
          (id, event_id, kind, mode, state, priority, attempts, max_attempts, max_minutes,
           params_json, progress, result_json, created_at, updated_at)
         VALUES (?, ?, 'edit', 'manual', 'review_pending', 50, 1, 2, 120, '{}', 100, ?, ?, ?)`,
        jobId,
        event.id,
        JSON.stringify({ ok: true, outputs: [{ path: 'final.mp4' }] }),
        now,
        now,
      );

      const result = office.assets.trashSources(event.id, event.title, null);
      expect(result.moved).toBe(1);
      const after = office.events.get(event.id);
      expect(after.assets[0]?.status).toBe('trashed');
      expect(existsSync(join(volumeRoot, ...after.assets[0]!.relPath.split('/')))).toBe(false);
      expect(existsSync(join(volumeRoot, ...result.trashRel.split('/')))).toBe(true);
      expect(office.jobs.get(jobId).resultJson).toBeTruthy();
      void root;
    });
  });
});
