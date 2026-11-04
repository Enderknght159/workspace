import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { DEFAULT_MAX_ATTEMPTS, type ReviewDecision } from '../../shared/constants.js';
import type { JobFile, ResultFile } from '../../shared/job-contract.js';
import type { JobDetail, JobLogEntry, JobSummary, QueueStats } from '../../shared/models.js';
import { appendRel, joinRel } from '../../shared/paths.js';
import type { CreateJobRequest, PublishJobRequest, ReviewJobRequest } from '../../shared/schemas.js';
import type { JobState } from '../../shared/state-machines.js';
import type { Database } from '../db/database.js';
import type { EventBus } from '../util/event-bus.js';
import type { Logger } from '../util/logger.js';
import { writeJsonAtomic } from '../office/config.js';
import type { OfficePaths } from '../office/paths.js';
import type { AuditService } from './audit-service.js';
import type { EventService } from './event-service.js';
import { mapJobRow, safeJson } from './event-service.js';
import type { SettingsService } from './settings-service.js';
import type { StyleService } from './style-service.js';
import type { VolumeService } from './volume-service.js';

export interface JobQueuePort {
  kick(): void;
  cancel(jobId: string): void;
}

export interface JobServiceDeps {
  db: Database;
  paths: OfficePaths;
  events: EventService;
  volumes: VolumeService;
  styles: StyleService;
  settings: SettingsService;
  audit: AuditService;
  bus: EventBus;
  logger: Logger;
  clock?: () => Date;
  machineId: string;
}

interface JobRow {
  id: string;
  event_id: string;
  event_title: string;
  kind: string;
  mode: string;
  style_id: string | null;
  style_name: string | null;
  style_version: string | null;
  style_hash: string | null;
  state: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  max_minutes: number;
  agent_session_id: string | null;
  workspace_rel: string | null;
  params_json: string;
  parent_job_id: string | null;
  revision_reason: string | null;
  progress: number;
  step: string | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  machine_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export class JobService {
  private queue: JobQueuePort | null = null;
  private readonly clock: () => Date;

  constructor(private readonly deps: JobServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  attachQueue(queue: JobQueuePort): void {
    this.queue = queue;
  }

  create(input: CreateJobRequest, actorId: string | null): JobDetail {
    const event = this.deps.events.get(input.eventId);
    if (!event.volumeId || !event.relPath) throw new AppError('WS-2002', { eventId: event.id });
    const volume = this.deps.volumes.get(event.volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId: event.volumeId });

    let styleId = input.styleId ?? null;
    if (!styleId && ['edit', 'reel', 'export'].includes(input.kind)) {
      const enabled = this.deps.styles.list(false);
      styleId = enabled[0]?.id ?? null;
    }
    const style = styleId ? this.deps.styles.get(styleId) : null;
    if (['edit', 'reel', 'export'].includes(input.kind) && !style) {
      throw new AppError('WS-5008', { kind: input.kind });
    }

    const id = newId('job');
    const workspaceRel = joinRel(event.relPath, 'work', id);
    const outputRel = joinRel(event.relPath, 'output', id);
    const now = this.clock().toISOString();
    const maxMinutes = input.maxMinutes ?? this.deps.settings.get().queue.defaultMaxMinutes;
    this.deps.db.run(
      `INSERT INTO jobs
        (id, event_id, kind, mode, style_id, style_version, style_hash, state, priority,
         attempts, max_attempts, max_minutes, workspace_rel, params_json, progress,
         created_at, updated_at, machine_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id,
      event.id,
      input.kind,
      input.mode,
      style?.id ?? null,
      style?.version ?? null,
      style?.hash ?? null,
      input.priority ?? 50,
      DEFAULT_MAX_ATTEMPTS,
      maxMinutes,
      workspaceRel,
      JSON.stringify(input.params ?? {}),
      now,
      now,
      this.deps.machineId,
    );

    const job = this.get(id);
    this.writeJobFile(id);
    this.deps.audit.record({
      actorId,
      action: 'job.create',
      entity: 'job',
      entityId: id,
      after: { kind: input.kind, styleId: style?.id ?? null, eventId: event.id, outputRel },
    });
    this.publishJob(job);
    this.queue?.kick();
    this.deps.logger.info('job.created', { jobId: id, kind: input.kind, styleId });
    return job;
  }

  list(filter: { state?: JobState; eventId?: string; limit?: number } = {}): JobSummary[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.state) {
      clauses.push('j.state = ?');
      params.push(filter.state);
    }
    if (filter.eventId) {
      clauses.push('j.event_id = ?');
      params.push(filter.eventId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.deps.db.all<JobRow>(
      `SELECT j.*, e.title AS event_title, s.name AS style_name
       FROM jobs j JOIN events e ON e.id = j.event_id
       LEFT JOIN styles s ON s.id = j.style_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT ?`,
      ...params,
      filter.limit ?? 100,
    );
    return rows.map(mapJobRow);
  }

  get(id: string): JobDetail {
    const row = this.getRow(id);
    const summary = mapJobRow(row);
    const logs = this.deps.db
      .all<JobLogRow>('SELECT * FROM job_logs WHERE job_id = ? ORDER BY id DESC LIMIT 200', id)
      .reverse()
      .map(mapLogRow);
    const review = this.deps.db.get<ReviewRow>(
      'SELECT * FROM reviews WHERE job_id = ? ORDER BY created_at DESC LIMIT 1',
      id,
    );
    const publication = this.deps.db.get<PublicationRow>(
      'SELECT * FROM publications WHERE job_id = ? ORDER BY published_at DESC LIMIT 1',
      id,
    );
    const style = row.style_id ? this.deps.styles.list().find((entry) => entry.id === row.style_id) : null;
    const result = safeJson<{ outputs?: JobDetail['outputs'] }>(row.result_json, {});
    return {
      ...summary,
      checklist: style?.checklist ?? [],
      logs,
      review: review
        ? {
            id: review.id,
            jobId: review.job_id,
            reviewerId: review.reviewer_id,
            decision: review.decision as ReviewDecision,
            checklist: safeJson<Record<string, boolean>>(review.checklist_json, {}),
            notes: review.notes,
            createdAt: review.created_at,
          }
        : null,
      publication: publication
        ? {
            id: publication.id,
            jobId: publication.job_id,
            platform: publication.platform,
            url: publication.url,
            publishedAt: publication.published_at,
            publishedBy: publication.published_by,
          }
        : null,
      outputs: result.outputs ?? [],
    };
  }

  getRow(id: string): JobRow {
    const row = this.deps.db.get<JobRow>(
      `SELECT j.*, e.title AS event_title, s.name AS style_name
       FROM jobs j JOIN events e ON e.id = j.event_id
       LEFT JOIN styles s ON s.id = j.style_id
       WHERE j.id = ?`,
      id,
    );
    if (!row) throw new AppError('WS-5001', { jobId: id });
    return row;
  }

  buildJobFile(id: string): {
    jobFile: JobFile;
    volumeRoot: string;
    eventDir: string;
    workDir: string;
    outputDir: string;
    jobFileRel: string;
    workRel: string;
    outputRel: string;
  } {
    const row = this.getRow(id);
    const event = this.deps.events.get(row.event_id);
    if (!event.volumeId || !event.relPath) throw new AppError('WS-2002', { eventId: event.id });
    const volume = this.deps.volumes.get(event.volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId: event.volumeId });
    const style = row.style_id ? this.deps.styles.list().find((entry) => entry.id === row.style_id) : null;
    const params = safeJson<Record<string, unknown>>(row.params_json, {});
    const required = normalizeRequired(
      style && style.outputs.length > 0 ? style.outputs : requiredForKind(row.kind),
    );
    const workRel = row.workspace_rel ?? joinRel(event.relPath, 'work', id);
    const outputRel = joinRel(event.relPath, 'output', id);
    const video = event.assets.find((asset) => asset.kind === 'video');
    const audio = event.assets.find((asset) => asset.kind === 'audio');
    const jobFile: JobFile = {
      schema: 1,
      job_id: row.id,
      event: {
        id: event.id,
        title: event.title,
        kind: event.kind,
        date: event.occurredAt,
      },
      inputs: {
        SOURCE_VIDEO: video?.relPath ?? '',
        SOURCE_AUDIO: audio?.relPath ?? '',
        ASSETS: event.assets.map((asset) => asset.relPath),
        EVENT_TITLE: event.title,
        EVENT_DATE: event.occurredAt,
        EVENT_KIND: event.kind,
        WORK_DIR: workRel,
        OUTPUT_DIR: outputRel,
        REVISION_NOTES: row.revision_reason ?? '',
      },
      style: {
        id: row.style_id ?? 'none',
        version: row.style_version ?? '0',
        params,
      },
      output: {
        dir: outputRel,
        required,
      },
      limits: {
        max_minutes: row.max_minutes,
      },
    };
    return {
      jobFile,
      volumeRoot: volume.root,
      eventDir: this.deps.paths.resolveInside(volume.root, event.relPath),
      workDir: this.deps.paths.resolveInside(volume.root, workRel),
      outputDir: this.deps.paths.resolveInside(volume.root, outputRel),
      jobFileRel: appendRel(workRel, 'job.json'),
      workRel,
      outputRel,
    };
  }

  writeJobFile(id: string): JobFile {
    const built = this.buildJobFile(id);
    mkdirSync(built.workDir, { recursive: true });
    mkdirSync(built.outputDir, { recursive: true });
    writeJsonAtomic(join(built.workDir, 'job.json'), built.jobFile);
    return built.jobFile;
  }

  startJob(id: string): JobDetail | null {
    const now = this.clock().toISOString();
    const result = this.deps.db.run(
      `UPDATE jobs SET state = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL,
        progress = 0, step = 'بدء التنفيذ', error_code = NULL, error_message = NULL, updated_at = ?
       WHERE id = ? AND state = 'queued'`,
      now,
      now,
      id,
    );
    if (result.changes === 0) return null;
    const job = this.get(id);
    this.appendLog(id, 'info', 'بدأت الوظيفة');
    this.publishJob(job);
    this.deps.events.recompute(job.eventId);
    return job;
  }

  updateProgress(id: string, progress: number, step: string): void {
    this.deps.db.run(
      'UPDATE jobs SET progress = ?, step = ?, updated_at = ? WHERE id = ? AND state = ?',
      Math.max(0, Math.min(100, Math.round(progress))),
      step,
      this.clock().toISOString(),
      id,
      'running',
    );
    const row = this.deps.db.get<{ event_id: string; state: string; progress: number; step: string | null }>(
      'SELECT event_id, state, progress, step FROM jobs WHERE id = ?',
      id,
    );
    if (row) {
      this.deps.bus.publish({
        type: 'job.updated',
        jobId: id,
        eventId: row.event_id,
        state: row.state as JobState,
        step: row.step,
        progress: row.progress,
      });
    }
  }

  appendLog(id: string, level: JobLogEntry['level'], message: string, data?: unknown): void {
    this.deps.db.run(
      'INSERT INTO job_logs (job_id, at, level, message, data) VALUES (?, ?, ?, ?, ?)',
      id,
      this.clock().toISOString(),
      level,
      message,
      data === undefined ? null : JSON.stringify(data).slice(0, 8000),
    );
    if (level !== 'debug') {
      this.deps.bus.publish({
        type: 'log',
        level,
        message,
        jobId: id,
      });
    }
  }

  finishSuccess(id: string, result: ResultFile, sessionId: string | null): JobDetail {
    const now = this.clock().toISOString();
    this.deps.db.run(
      `UPDATE jobs SET state = 'review_pending', progress = 100, step = 'بانتظار المراجعة',
        result_json = ?, agent_session_id = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(result),
      sessionId,
      now,
      now,
      id,
    );
    const job = this.get(id);
    this.appendLog(id, 'info', 'اكتملت الوظيفة وبانتظار المراجعة');
    this.publishJob(job);
    this.deps.events.recompute(job.eventId);
    return job;
  }

  finishFailure(id: string, error: AppError, allowRetry: boolean): JobDetail {
    const row = this.getRow(id);
    const now = this.clock().toISOString();
    const retry = allowRetry && row.attempts < row.max_attempts;
    this.deps.db.run(
      `UPDATE jobs SET state = ?, error_code = ?, error_message = ?, finished_at = ?,
        step = ?, updated_at = ?, progress = CASE WHEN ? THEN 0 ELSE progress END
       WHERE id = ?`,
      retry ? 'queued' : 'failed',
      error.code,
      error.message,
      now,
      retry ? 'إعادة محاولة تلقائية' : 'فشلت الوظيفة',
      now,
      retry ? 1 : 0,
      id,
    );
    const job = this.get(id);
    this.appendLog(id, 'error', error.message, { code: error.code, details: error.details });
    this.publishJob(job);
    this.deps.events.recompute(job.eventId);
    if (retry) this.queue?.kick();
    return job;
  }

  finishCancelled(id: string): JobDetail {
    const now = this.clock().toISOString();
    this.deps.db.run(
      `UPDATE jobs SET state = 'cancelled', step = 'أُلغيت', finished_at = ?, updated_at = ? WHERE id = ?`,
      now,
      now,
      id,
    );
    const job = this.get(id);
    this.appendLog(id, 'warn', 'أُلغيت الوظيفة');
    this.publishJob(job);
    this.deps.events.recompute(job.eventId);
    return job;
  }

  blockJob(id: string, error: AppError, offline = false): void {
    const now = this.clock().toISOString();
    this.deps.db.run(
      `UPDATE jobs SET state = ?, error_code = ?, error_message = ?, step = ?, updated_at = ?
       WHERE id = ?`,
      offline ? 'blocked_offline' : 'blocked',
      error.code,
      error.message,
      error.message,
      now,
      id,
    );
    this.appendLog(id, 'warn', error.message, { code: error.code });
    this.publishJob(this.get(id));
  }

  requeueInterrupted(): number {
    const result = this.deps.db.run(
      `UPDATE jobs SET state = 'queued', step = 'استئناف بعد إعادة التشغيل', updated_at = ?
       WHERE state IN ('running', 'interrupted')`,
      this.clock().toISOString(),
    );
    return result.changes;
  }

  requeueOffline(): number {
    const rows = this.deps.db.all<{ id: string; event_id: string }>(
      "SELECT id, event_id FROM jobs WHERE state = 'blocked_offline'",
    );
    let count = 0;
    for (const row of rows) {
      const event = this.deps.db.get<{ volume_id: string | null }>(
        'SELECT volume_id FROM events WHERE id = ?',
        row.event_id,
      );
      const volume = event?.volume_id ? this.deps.volumes.get(event.volume_id) : null;
      if (volume?.root && volume.status === 'connected') {
        this.deps.db.run(
          "UPDATE jobs SET state = 'queued', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?",
          this.clock().toISOString(),
          row.id,
        );
        count += 1;
      }
    }
    return count;
  }

  review(id: string, input: ReviewJobRequest, actorId: string | null): JobDetail {
    const job = this.get(id);
    if (job.review) throw new AppError('WS-6003', { jobId: id });
    if (job.state !== 'review_pending') throw new AppError('WS-5002', { state: job.state });

    if (input.decision === 'approved') {
      const missing = job.checklist.filter(
        (item) => item.required && input.checklist[item.id] !== true,
      );
      if (missing.length > 0) {
        throw new AppError('WS-6001', { missing: missing.map((item) => item.label) });
      }
    }

    const reviewId = newId('rev');
    const now = this.clock().toISOString();
    this.deps.db.run(
      `INSERT INTO reviews (id, job_id, reviewer_id, decision, checklist_json, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      reviewId,
      id,
      input.reviewerId ?? actorId ?? 'usr_local',
      input.decision,
      JSON.stringify(input.checklist),
      input.notes ?? null,
      now,
    );

    if (input.decision === 'approved') {
      this.deps.db.run("UPDATE jobs SET state = 'approved', step = 'معتمدة', updated_at = ? WHERE id = ?", now, id);
    } else {
      this.deps.db.run("UPDATE jobs SET state = 'rejected', step = 'أُعيدت للتعديل', updated_at = ? WHERE id = ?", now, id);
      if (input.decision === 'revision') {
        const row = this.getRow(id);
        const revision = this.create(
          {
            eventId: row.event_id,
            kind: row.kind as CreateJobRequest['kind'],
            mode: row.mode as CreateJobRequest['mode'],
            styleId: row.style_id,
            params: safeJson<Record<string, unknown>>(row.params_json, {}),
            priority: row.priority,
          },
          actorId,
        );
        this.deps.db.run(
          'UPDATE jobs SET parent_job_id = ?, revision_reason = ? WHERE id = ?',
          id,
          input.notes ?? '',
          revision.id,
        );
        this.writeJobFile(revision.id);
        this.appendLog(revision.id, 'info', 'وظيفة مراجعة جديدة', { parentJobId: id, notes: input.notes });
      }
    }

    this.deps.audit.record({
      actorId,
      action: `job.review.${input.decision}`,
      entity: 'job',
      entityId: id,
      before: { state: job.state },
      after: { decision: input.decision, notes: input.notes ?? null, checklist: input.checklist },
    });
    const updated = this.get(id);
    this.publishJob(updated);
    this.deps.events.recompute(updated.eventId);
    return updated;
  }

  publish(id: string, input: PublishJobRequest, actorId: string | null): JobDetail {
    const job = this.get(id);
    if (job.state !== 'approved') throw new AppError('WS-5002', { state: job.state });
    const publicationId = newId('pub');
    const now = this.clock().toISOString();
    this.deps.db.run(
      `INSERT INTO publications (id, job_id, platform, url, published_at, published_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      publicationId,
      id,
      input.platform,
      input.url,
      now,
      input.publishedBy ?? actorId ?? 'usr_local',
    );
    this.deps.db.run("UPDATE jobs SET state = 'published', step = 'نُشرت', updated_at = ? WHERE id = ?", now, id);
    this.deps.audit.record({
      actorId,
      action: 'job.publish',
      entity: 'job',
      entityId: id,
      after: { platform: input.platform, url: input.url },
    });
    const updated = this.get(id);
    this.publishJob(updated);
    this.deps.events.recompute(updated.eventId);

    const remaining = this.deps.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM jobs WHERE event_id = ? AND state NOT IN ('published','archived')`,
      updated.eventId,
    );
    if ((remaining?.count ?? 0) === 0) {
      try {
        this.deps.events.transition(updated.eventId, 'published', { actorId, reason: 'all jobs published' });
      } catch {
        // قد يكون الحدث في حالة لا تسمح؛ تبقى الوظيفة منشورة.
      }
    }
    return this.get(id);
  }

  retry(id: string): JobDetail {
    const job = this.get(id);
    if (!['failed', 'interrupted', 'cancelled'].includes(job.state)) {
      throw new AppError('WS-5002', { state: job.state });
    }
    if (job.attempts >= job.maxAttempts && job.state !== 'cancelled') {
      throw new AppError('WS-5006', { reason: 'max_attempts', attempts: job.attempts });
    }
    const now = this.clock().toISOString();
    this.deps.db.run(
      `UPDATE jobs SET state = 'queued', progress = 0, step = 'إعادة محاولة يدوية',
        error_code = NULL, error_message = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`,
      now,
      id,
    );
    const updated = this.get(id);
    this.publishJob(updated);
    this.queue?.kick();
    return updated;
  }

  cancel(id: string): JobDetail {
    const job = this.get(id);
    if (job.state === 'running') {
      this.queue?.cancel(id);
      return this.get(id);
    }
    if (!['queued', 'blocked', 'blocked_offline', 'interrupted', 'review_pending'].includes(job.state)) {
      throw new AppError('WS-5002', { state: job.state });
    }
    const now = this.clock().toISOString();
    this.deps.db.run(
      "UPDATE jobs SET state = 'cancelled', step = 'أُلغيت', finished_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      id,
    );
    const updated = this.get(id);
    this.publishJob(updated);
    this.deps.events.recompute(updated.eventId);
    return updated;
  }

  stats(): QueueStats {
    const rows = this.deps.db.all<{ state: string; count: number }>(
      'SELECT state, COUNT(*) AS count FROM jobs GROUP BY state',
    );
    const byState = new Map(rows.map((row) => [row.state, row.count]));
    return {
      queued: byState.get('queued') ?? 0,
      running: byState.get('running') ?? 0,
      failed: byState.get('failed') ?? 0,
      review: byState.get('review_pending') ?? 0,
    };
  }

  publishJob(job: JobSummary): void {
    this.deps.bus.publish({
      type: 'job.updated',
      jobId: job.id,
      eventId: job.eventId,
      state: job.state,
      step: job.step,
      progress: job.progress,
    });
    const stats = this.stats();
    this.deps.bus.publish({
      type: 'queue.stats',
      queued: stats.queued,
      running: stats.running,
      failed: stats.failed,
    });
  }

  private maxMinutesFor(row: JobRow): number {
    return row.max_minutes;
  }

  get machine(): string {
    return this.deps.machineId;
  }
}

function normalizeRequired(required: string[]): string[] {
  const out = new Set(required.filter((name) => name.length > 0));
  out.add('result.json');
  return [...out];
}

function requiredForKind(kind: string): string[] {
  switch (kind) {
    case 'transcribe':
      return ['transcript.json', 'result.json'];
    case 'thumbnail':
      return ['thumbnail.jpg', 'result.json'];
    case 'archive':
      return ['archive.json', 'result.json'];
    default:
      return ['final.mp4', 'result.json'];
  }
}

interface JobLogRow {
  id: number;
  job_id: string;
  at: string;
  level: string;
  message: string;
  data: string | null;
}

interface ReviewRow {
  id: string;
  job_id: string;
  reviewer_id: string | null;
  decision: string;
  checklist_json: string;
  notes: string | null;
  created_at: string;
}

interface PublicationRow {
  id: string;
  job_id: string;
  platform: string;
  url: string;
  published_at: string;
  published_by: string | null;
}

function mapLogRow(row: JobLogRow): JobLogEntry {
  return {
    id: row.id,
    jobId: row.job_id,
    at: row.at,
    level: row.level as JobLogEntry['level'],
    message: row.message,
    data: safeJson<unknown>(row.data, null),
  };
}

export type { JobRow };
