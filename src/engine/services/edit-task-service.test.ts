import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';

describe('premiere edit tasks', () => {
  it('plans a project in the event folder and registers an export', async () => {
    await withOffice(async ({ office, root, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const source = join(root, 'edit-source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'lesson.mp4'), 'edit-content');
      await office.ingest.run(
        { source, title: 'حدث المونتاج', slug: 'edit-event', occurredAt: '2026-11-04' },
        null,
      );
      const event = office.events.list({ limit: 10, offset: 0 }).items[0]!;

      const task = office.editTasks.create(
        { eventId: event.id, kind: 'full', title: 'مونتاج الحدث' },
        null,
      );
      expect(task.state).toBe('planned');
      expect(task.sources).toHaveLength(1);
      expect(task.projectRel).toContain('/edit/');
      expect(task.scriptPath && existsSync(task.scriptPath)).toBe(true);
      expect(task.jobFilePath && existsSync(task.jobFilePath)).toBe(true);

      const job = JSON.parse(readFileSync(task.jobFilePath!, 'utf8')) as {
        project_path: string;
        sequence: { width: number; height: number };
        sources: string[];
      };
      expect(job.project_path).toContain('project.prproj');
      expect(job.sequence.width).toBe(1920);
      expect(job.sources[0]).toContain('lesson.mp4');
      expect(existsSync(join(office.paths.root, 'integrations', 'premiere', 'queue', `${task.id}.json`))).toBe(true);

      writeFileSync(
        join(task.scriptPath!.replace('create-project.jsx', ''), 'premiere-result.json'),
        JSON.stringify({ ok: true, project_path: job.project_path }),
      );
      expect(office.editTasks.get(task.id).state).toBe('project_ready');

      const exportFile = join(task.outputPath!, 'final.mp4');
      writeFileSync(exportFile, 'final-video');
      const exported = office.editTasks.registerExport(task.id, { path: exportFile }, null);
      expect(exported.state).toBe('exported');
      expect(exported.exportedFileRel).toBeTruthy();
      expect(exported.exportedBytes).toBeGreaterThan(0);
    });
  });
});
