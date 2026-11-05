import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { EditTask, EditTaskDetail, EditTaskKind, EditTaskState } from '../../shared/models.js';
import type { CreateEditTaskRequest, RegisterEditExportRequest, UpdateEditTaskRequest } from '../../shared/schemas.js';
import type { Database } from '../db/database.js';
import { writeJsonAtomic, writeTextAtomic } from '../office/config.js';
import type { OfficePaths } from '../office/paths.js';
import type { AuditService } from './audit-service.js';
import type { EventService } from './event-service.js';
import type { VolumeService } from './volume-service.js';
import type { Logger } from '../util/logger.js';

export interface EditTaskServiceDeps {
  db: Database;
  paths: OfficePaths;
  events: EventService;
  volumes: VolumeService;
  audit: AuditService;
  logger: Logger;
}

interface EditTaskRow {
  id: string;
  event_id: string;
  event_title: string;
  kind: string;
  title: string;
  state: string;
  project_rel: string | null;
  output_rel: string | null;
  subtitle_rel: string | null;
  sequence_name: string | null;
  exported_file_rel: string | null;
  external_output_path: string | null;
  exported_bytes: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const KIND_LABELS: Record<EditTaskKind, string> = {
  full: 'مونتاج كامل',
  reel: 'ريل',
  khutbah: 'خطبة',
};

const SEQUENCE: Record<EditTaskKind, { width: number; height: number; fps: number }> = {
  full: { width: 1920, height: 1080, fps: 25 },
  khutbah: { width: 1920, height: 1080, fps: 25 },
  reel: { width: 1080, height: 1920, fps: 30 },
};

export class EditTaskService {
  constructor(private readonly deps: EditTaskServiceDeps) {}

  list(eventId?: string): EditTask[] {
    const rows = eventId
      ? this.deps.db.all<EditTaskRow>(
          `${BASE_QUERY} WHERE t.event_id = ? ORDER BY t.created_at DESC`,
          eventId,
        )
      : this.deps.db.all<EditTaskRow>(`${BASE_QUERY} ORDER BY t.created_at DESC`);
    return rows.map(mapRow);
  }

  get(id: string): EditTaskDetail {
    const row = this.deps.db.get<EditTaskRow>(`${BASE_QUERY} WHERE t.id = ?`, id);
    if (!row) throw new AppError('WS-0002', { editTaskId: id });
    this.syncFromResult(row);
    const refreshed = this.deps.db.get<EditTaskRow>(`${BASE_QUERY} WHERE t.id = ?`, id) ?? row;
    const event = this.deps.events.get(refreshed.event_id);
    const volume = event.volumeId ? this.deps.volumes.get(event.volumeId) : null;
    const root = volume?.root ?? null;
    const sources = this.deps.db
      .all<{ asset_id: string; rel_path: string; kind: string; bytes: number }>(
        `SELECT a.id AS asset_id, a.rel_path, a.kind, a.bytes
         FROM edit_task_assets eta JOIN assets a ON a.id = eta.asset_id
         WHERE eta.task_id = ?`,
        id,
      )
      .map((source) => ({
        assetId: source.asset_id,
        relPath: source.rel_path,
        kind: source.kind,
        bytes: source.bytes,
      }));
    const absolute = (rel: string | null): string | null =>
      rel && root ? this.deps.paths.resolveInside(root, rel) : null;
    return {
      ...mapRow(refreshed),
      projectPath: absolute(refreshed.project_rel),
      outputPath: absolute(refreshed.output_rel),
      subtitlePath: absolute(refreshed.subtitle_rel),
      scriptPath: absolute(refreshed.project_rel ? `${dirnameRel(refreshed.project_rel)}/create-project.jsx` : null),
      jobFilePath: absolute(refreshed.project_rel ? `${dirnameRel(refreshed.project_rel)}/premiere-job.json` : null),
      sources,
    };
  }

  create(input: CreateEditTaskRequest, actorId: string | null): EditTaskDetail {
    const event = this.deps.events.get(input.eventId);
    if (!event.volumeId || !event.relPath) throw new AppError('WS-2002', { eventId: event.id });
    const volume = this.deps.volumes.get(event.volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId: event.volumeId });
    const eventRel = event.relPath;
    const volumeRoot = volume.root;

    const videos = event.assets.filter((asset) => asset.status === 'present' && asset.kind === 'video');
    const selected = input.assetIds
      ? event.assets.filter((asset) => input.assetIds!.includes(asset.id) && asset.status === 'present')
      : videos;
    if (selected.length === 0) throw new AppError('WS-0003', { reason: 'no_sources' });

    const id = newId('edt');
    const sequence = SEQUENCE[input.kind];
    const workRel = joinRelSafe(eventRel, 'edit', id);
    const outputRel = joinRelSafe(eventRel, 'output', id);
    const subtitleRel = joinRelSafe(eventRel, 'subtitles', id);
    const projectRel = `${workRel}/project.prproj`;
    const sequenceName = `${input.title ?? event.title} — ${KIND_LABELS[input.kind]}`;
    const now = new Date().toISOString();

    const workDir = this.deps.paths.resolveInside(volumeRoot, workRel);
    const outputDir = this.deps.paths.resolveInside(volumeRoot, outputRel);
    const subtitleDir = this.deps.paths.resolveInside(volumeRoot, subtitleRel);
    mkdirSync(workDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(subtitleDir, { recursive: true });

    const sourcePaths = selected.map((asset) =>
      this.deps.paths.resolveInside(volumeRoot, asset.relPath),
    );
    const subtitles = collectSubtitles(volumeRoot, eventRel, subtitleDir);
    const job = {
      schema: 1,
      task_id: id,
      event: {
        id: event.id,
        title: event.title,
        kind: event.kind,
        date: event.occurredAt,
      },
      project_path: toSlash(join(workDir, 'project.prproj')),
      sequence: { name: sequenceName, ...sequence },
      sources: sourcePaths.map((path) => toSlash(path)),
      subtitles: subtitles.map((path) => toSlash(path)),
      output_dir: toSlash(outputDir),
      subtitle_dir: toSlash(subtitleDir),
      result_path: toSlash(join(workDir, 'premiere-result.json')),
      created_at: now,
    };
    writeJsonAtomic(join(workDir, 'premiere-job.json'), job);
    writeTextAtomic(join(workDir, 'create-project.jsx'), buildJsx(job));
    writeTextAtomic(
      join(outputDir, 'EXPORT_HERE.txt'),
      `صدّر Sequence «${sequenceName}» إلى هذا المجلد.\n${outputDir}\n`,
    );
    const queueDir = join(this.deps.paths.root, 'integrations', 'premiere', 'queue');
    mkdirSync(queueDir, { recursive: true });
    writeJsonAtomic(join(queueDir, `${id}.json`), {
      task_id: id,
      job_path: toSlash(join(workDir, 'premiere-job.json')),
      jsx_path: toSlash(join(workDir, 'create-project.jsx')),
      created_at: now,
    });

    this.deps.db.run(
      `INSERT INTO edit_tasks
        (id, event_id, kind, title, state, project_rel, output_rel, subtitle_rel, sequence_name,
         notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      event.id,
      input.kind,
      input.title ?? event.title,
      projectRel,
      outputRel,
      subtitleRel,
      sequenceName,
      input.notes ?? null,
      actorId,
      now,
      now,
    );
    for (const asset of selected) {
      this.deps.db.run(
        'INSERT INTO edit_task_assets (task_id, asset_id, role) VALUES (?, ?, ?)',
        id,
        asset.id,
        asset.id === selected[0]?.id ? 'primary' : 'source',
      );
    }
    this.deps.audit.record({
      actorId,
      action: 'edit_task.create',
      entity: 'edit_task',
      entityId: id,
      after: { eventId: event.id, kind: input.kind, sources: selected.length, projectRel },
    });
    this.deps.logger.info('edit_task.created', { taskId: id, eventId: event.id });
    return this.get(id);
  }

  update(id: string, patch: UpdateEditTaskRequest, actorId: string | null): EditTaskDetail {
    const before = this.get(id);
    this.deps.db.run(
      'UPDATE edit_tasks SET title = ?, state = ?, notes = ?, updated_at = ? WHERE id = ?',
      patch.title ?? before.title,
      patch.state ?? before.state,
      patch.notes ?? before.notes,
      new Date().toISOString(),
      id,
    );
    this.deps.audit.record({
      actorId,
      action: 'edit_task.update',
      entity: 'edit_task',
      entityId: id,
      before: { title: before.title, state: before.state },
      after: patch,
    });
    return this.get(id);
  }

  registerExport(id: string, input: RegisterEditExportRequest, actorId: string | null): EditTaskDetail {
    const task = this.get(id);
    if (!existsSync(input.path)) throw new AppError('WS-0002', { path: input.path });
    const stats = statSync(input.path);
    const event = this.deps.events.get(task.eventId);
    const volume = event.volumeId ? this.deps.volumes.get(event.volumeId) : null;
    let rel: string | null = null;
    let external: string | null = null;
    if (volume?.root) {
      try {
        rel = this.deps.paths.toRelative(volume.root, input.path);
      } catch {
        rel = null;
      }
    }
    if (!rel) external = input.path;
    this.deps.db.run(
      `UPDATE edit_tasks SET exported_file_rel = ?, external_output_path = ?, exported_bytes = ?,
        state = 'exported', updated_at = ? WHERE id = ?`,
      rel,
      external,
      stats.size,
      new Date().toISOString(),
      id,
    );
    this.deps.audit.record({
      actorId,
      action: 'edit_task.export_registered',
      entity: 'edit_task',
      entityId: id,
      after: { rel, external, bytes: stats.size },
    });
    return this.get(id);
  }

  private syncFromResult(row: EditTaskRow): void {
    if (!row.project_rel) return;
    if (row.state !== 'planned' && row.state !== 'editing') return;
    const event = this.deps.db.get<{ volume_id: string | null }>(
      'SELECT volume_id FROM events WHERE id = ?',
      row.event_id,
    );
    if (!event?.volume_id) return;
    const volume = this.deps.volumes.get(event.volume_id);
    if (!volume?.root) return;
    const resultPath = this.deps.paths.resolveInside(
      volume.root,
      `${dirnameRel(row.project_rel)}/premiere-result.json`,
    );
    if (!existsSync(resultPath)) return;
    try {
      const result = JSON.parse(readFileSync(resultPath, 'utf8')) as { ok?: boolean; error?: string };
      if (result.ok) {
        this.deps.db.run(
          "UPDATE edit_tasks SET state = 'project_ready', updated_at = ? WHERE id = ? AND state = 'planned'",
          new Date().toISOString(),
          row.id,
        );
      } else if (result.error) {
        this.deps.db.run(
          'UPDATE edit_tasks SET notes = ?, updated_at = ? WHERE id = ?',
          `فشل إنشاء المشروع: ${result.error}`,
          new Date().toISOString(),
          row.id,
        );
      }
    } catch {
      // ملف نتيجة غير مكتمل.
    }
  }
}

const BASE_QUERY = `SELECT t.*, e.title AS event_title FROM edit_tasks t JOIN events e ON e.id = t.event_id`;

function mapRow(row: EditTaskRow): EditTask {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    kind: row.kind as EditTaskKind,
    title: row.title,
    state: row.state as EditTaskState,
    projectRel: row.project_rel,
    outputRel: row.output_rel,
    subtitleRel: row.subtitle_rel,
    sequenceName: row.sequence_name,
    exportedFileRel: row.exported_file_rel,
    externalOutputPath: row.external_output_path,
    exportedBytes: row.exported_bytes,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function joinRelSafe(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function dirnameRel(rel: string): string {
  return rel.slice(0, rel.lastIndexOf('/'));
}

function toSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

function collectSubtitles(volumeRoot: string, eventRel: string, taskSubtitleDir: string): string[] {
  const out: string[] = [];
  for (const dir of [taskSubtitleDir, join(volumeRoot, ...eventRel.split('/'), 'subtitles')]) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(srt|vtt|ass)$/i.test(entry.name)) out.push(join(dir, entry.name));
      }
    } catch {
      // تجاهل.
    }
  }
  return Array.from(new Set(out));
}

function buildJsx(job: Record<string, unknown>): string {
  const jobJson = JSON.stringify(job, null, 2);
  return `// Created by Workspace — project bootstrap
// Run from Premiere: File > Scripts > Run Script File
(function () {
  var job = ${jobJson};
  var result = { ok: false, project_path: job.project_path, sequence: job.sequence.name, error: null };
  function quote(value) {
    return '"' + String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\r/g, '\\\\r').replace(/\\n/g, '\\\\n') + '"';
  }
  function writeResult() {
    var f = new File(job.result_path);
    f.encoding = "UTF-8";
    var payload = '{"ok":' + (result.ok ? 'true' : 'false') +
      ',"project_path":' + quote(result.project_path) +
      ',"sequence":' + quote(result.sequence) +
      ',"error":' + (result.error ? quote(result.error) : 'null') + '}';
    if (f.open("w")) { f.write(payload); f.close(); }
  }
  try {
    app.newProject(job.project_path);
    var imported = app.project.importFiles(job.sources, true, app.project.rootItem, false);
    if (job.subtitles && job.subtitles.length > 0) {
      app.project.importFiles(job.subtitles, true, app.project.rootItem, false);
    }
    var items = [];
    var children = app.project.rootItem.children;
    for (var i = 0; i < children.numItems; i++) {
      var item = children[i];
      if (item && item.type === 1) items.push(item);
    }
    var seq = null;
    if (items.length > 0) {
      seq = app.project.createNewSequenceFromClips(job.sequence.name, items, app.project.rootItem);
    } else {
      seq = app.project.createNewSequence(job.sequence.name, "");
    }
    if (seq) {
      try {
        var settings = seq.getSettings();
        settings.videoFrameWidth = job.sequence.width;
        settings.videoFrameHeight = job.sequence.height;
        settings.videoFrameRate = job.sequence.fps;
        seq.setSettings(settings);
      } catch (ignore) {}
    }
    app.project.save();
    result.ok = true;
  } catch (error) {
    result.error = String(error);
  }
  writeResult();
  return result.ok ? "OK" : "ERROR: " + result.error;
})();
`;
}
