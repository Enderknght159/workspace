import { existsSync, mkdirSync, writeFileSync } from 'node:fs';import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';

describe('card ingest', () => {
  it('honors an explicit event kind over folder-name detection', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'card-x');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'clip.mp4'), 'bytes');
      const preview = await office.ingest.preview({ source, kind: 'khutbah' });
      expect(preview.suggested.kind).toBe('khutbah');
    });
  });

  it('copies, hashes, verifies, deduplicates, and organizes media', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);

      const source = join(root, '20261104_lesson_card');
      mkdirSync(join(source, 'DCIM'), { recursive: true });
      writeFileSync(join(source, 'a.mp4'), 'video-content');
      writeFileSync(join(source, 'b.mp4'), 'video-content');
      writeFileSync(join(source, 'DCIM', 'photo.jpg'), 'image-content');

      const preview = await office.ingest.preview({ source });
      expect(preview.totalFiles).toBe(3);
      expect(preview.suggested.kind).toBe('lesson');
      expect(preview.suggested.occurredAt).toBe('2026-11-04');
      expect(preview.blocked).toBe(false);

      const batch = await office.ingest.run({ source }, 'usr_local');
      expect(batch.state).toBe('completed');
      expect(batch.totalFiles).toBe(3);
      expect(batch.copiedFiles).toBe(3);
      expect(batch.verifiedFiles).toBe(2);
      expect(batch.error).toBeNull();

      const events = office.events.list({ limit: 10, offset: 0 });
      expect(events.total).toBe(1);
      const event = office.events.get(events.items[0]!.id);
      expect(event.state).toBe('ingested');
      expect(event.assets).toHaveLength(2);
      expect(event.assets.every((asset) => asset.sha256.length === 64)).toBe(true);

      for (const asset of event.assets) {
        expect(existsSync(join(volumeRoot, ...asset.relPath.split('/')))).toBe(true);
      }
      expect(existsSync(join(volumeRoot, '00_inbox', batch.id))).toBe(false);

      // المصدر لا يُمس.
      expect(existsSync(join(source, 'a.mp4'))).toBe(true);
      expect(existsSync(join(source, 'DCIM', 'photo.jpg'))).toBe(true);

      const manifest = event.manifest as { assets?: unknown[] } | null;
      expect(manifest?.assets).toHaveLength(2);

      const audit = office.audit.list({ entity: 'event', entityId: event.id });
      expect(audit.some((entry) => entry.action === 'ingest.start')).toBe(true);
    });
  });

  it('blocks ingest when media is empty', async () => {    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'empty');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'notes.txt'), 'not media');

      const preview = await office.ingest.preview({ source });
      expect(preview.blocked).toBe(true);
      expect(preview.blockReason).toBe('no_media');
      await expect(office.ingest.run({ source }, null)).rejects.toMatchObject({ code: 'WS-3005' });
    });
  });

  it('fails cleanly when every file is already in the catalog', async () => {    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const first = join(root, 'first');
      mkdirSync(first, { recursive: true });
      writeFileSync(join(first, 'clip.mp4'), 'same-bytes');
      await office.ingest.run({ source: first }, null);

      const second = join(root, 'second');
      mkdirSync(second, { recursive: true });
      writeFileSync(join(second, 'copy.mp4'), 'same-bytes');
      await expect(office.ingest.run({ source: second }, null)).rejects.toMatchObject({
        code: 'WS-3004',
      });

      const batches = office.ingest.listBatches();
      expect(batches[0]?.state).toBe('failed');
      expect(office.events.list({ limit: 10, offset: 0 }).total).toBe(1);
    });
  });
});
