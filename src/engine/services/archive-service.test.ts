import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('waitFor timeout');
}

describe('archive', () => {
  it('copies, verifies, trash-moves and marks the event cold', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      const hot = office.volumes.register(
        { root: volumeRoot, label: 'Hot', kind: 'hot' },
        null,
        office.config.id,
      );
      const coldRoot = join(root, 'cold');
      mkdirSync(coldRoot, { recursive: true });
      const cold = office.volumes.register(
        { root: coldRoot, label: 'Cold', kind: 'cold' },
        null,
        office.config.id,
      );

      const source = join(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'clip.mp4'), 'archive-me');
      await office.ingest.run({ source, title: 'درس الأرشيف', slug: 'archive-lesson' }, null);
      const event = office.events.list({ limit: 10, offset: 0 }).items[0]!;

      const job = office.jobs.create({ eventId: event.id, kind: 'edit', mode: 'manual' }, null);
      office.queue.start();
      await waitFor(() => office.jobs.get(job.id).state === 'review_pending');
      const detail = office.jobs.get(job.id);
      office.jobs.review(
        job.id,
        {
          decision: 'approved',
          checklist: Object.fromEntries(detail.checklist.map((item) => [item.id, true])),
        },
        null,
      );
      office.jobs.publish(job.id, { platform: 'youtube', url: 'https://example.com/a' }, null);
      office.db.run(
        "UPDATE publications SET published_at = ? WHERE job_id = ?",
        new Date(Date.now() - 30 * 86_400_000).toISOString(),
        job.id,
      );

      const candidates = office.archive.candidates();
      expect(candidates).toHaveLength(1);

      const dry = await office.archive.run({
        targetVolumeId: cold.id,
        dryRun: true,
        actorId: null,
      });
      expect(dry.copied).toBe(1);
      expect(existsSync(join(coldRoot, 'WorkspaceCold'))).toBe(true);

      const report = await office.archive.run({
        targetVolumeId: cold.id,
        dryRun: false,
        actorId: null,
      });
      expect(report.copied).toBe(1);
      expect(report.failed).toBe(0);

      const archivedEvent = office.events.get(event.id);
      expect(archivedEvent.state).toBe('cold');
      expect(archivedEvent.assets[0]?.status).toBe('archived');

      const asset = archivedEvent.assets[0]!;
      expect(existsSync(join(coldRoot, 'WorkspaceCold', ...asset.relPath.split('/')))).toBe(true);
      expect(existsSync(join(volumeRoot, ...asset.relPath.split('/')))).toBe(false);
      expect(existsSync(join(volumeRoot, '90_trash'))).toBe(true);

      expect(office.archive.candidates()).toHaveLength(0);
      expect(office.volumes.get(hot.id)?.status).toBe('connected');
    });
  });
});
