import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import { withOffice } from '../testing/harness.js';

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor timeout');
}

describe('job queue and review', () => {
  it('runs a mock job end-to-end, reviews and publishes it', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'clip.mp4'), 'fake video bytes');
      const batch = await office.ingest.run({ source, title: 'درس الاختبار', slug: 'test-lesson' }, null);
      expect(batch.state).toBe('completed');
      const event = office.events.list({ limit: 10, offset: 0 }).items[0]!;

      const job = office.jobs.create(
        { eventId: event.id, kind: 'edit', mode: 'manual' },
        'usr_local',
      );
      expect(job.state).toBe('queued');
      expect(job.styleId).toBe('sample-reel');

      office.queue.start();
      await waitFor(() => office.jobs.get(job.id).state === 'review_pending');

      const completed = office.jobs.get(job.id);
      expect(completed.progress).toBe(100);
      expect(completed.outputs.length).toBeGreaterThan(0);
      const outputDir = join(volumeRoot, ...event.relPath!.split('/'), 'output', job.id);
      expect(existsSync(join(outputDir, 'final.mp4'))).toBe(true);
      expect(existsSync(join(outputDir, 'result.json'))).toBe(true);

      let failure: unknown;
      try {
        office.jobs.review(job.id, { decision: 'approved', checklist: {} }, 'usr_local');
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AppError);
      expect((failure as AppError).code).toBe('WS-6001');

      const checklist = Object.fromEntries(completed.checklist.map((item) => [item.id, true]));
      const approved = office.jobs.review(
        job.id,
        { decision: 'approved', checklist, notes: 'مراجعة أولية' },
        'usr_local',
      );
      expect(approved.state).toBe('approved');
      expect(office.events.get(event.id).state).toBe('approved');

      const published = office.jobs.publish(
        job.id,
        { platform: 'youtube', url: 'https://example.com/v/1' },
        'usr_local',
      );
      expect(published.state).toBe('published');
      expect(published.publication?.platform).toBe('youtube');
      expect(office.events.get(event.id).state).toBe('published');

      await office.queue.stop();
    });
  });

  it('creates a revision job with the rejection reason', async () => {
    await withOffice(async ({ office, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      office.queue.stop();
      const event = office.events.create(
        { kind: 'lesson', title: 'درس', occurredAt: '2026-11-04' },
        null,
      );
      // لا يوجد قرص هنا، لذا نتحقق فقط من رفض المراجعة بقائمة ناقصة.
      expect(event.state).toBe('draft');

      const job = office.jobs.create({ eventId: event.id, kind: 'edit', mode: 'manual' }, null);
      office.db.run("UPDATE jobs SET state = 'review_pending' WHERE id = ?", job.id);
      const rejected = office.jobs.review(
        job.id,
        { decision: 'revision', checklist: {}, notes: 'الصوت منخفض في البداية' },
        'usr_local',
      );
      expect(rejected.state).toBe('rejected');
      const jobs = office.jobs.list({ eventId: event.id });
      expect(jobs).toHaveLength(2);
      const revision = jobs.find((entry) => entry.id !== job.id);
      expect(revision?.state).toBe('queued');
    });
  });
});
