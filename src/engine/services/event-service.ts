import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import type { Asset, EventDetail, EventSummary, JobSummary, Page, Publication, Review } from '../../shared/models.js';
import { ensureSlug, eventRelPath, normalizeRel } from '../../shared/paths.js';
import { newId } from '../../shared/ids.js';
import type { CreateEventRequest, ListQuery, UpdateEventRequest } from '../../shared/schemas.js';
import {
  assertEventTransition,
  canTransition,
  EVENT_TRANSITIONS,
  type EventState,
} from '../../shared/state-machines.js';
import type { Database } from '../db/database.js';
import type { SqlValue } from '../db/driver.js';
import type { EventBus } from '../util/event-bus.js';
import type { Logger } from '../util/logger.js';
import { writeJsonAtomic } from '../office/config.js';
import { OfficePaths } from '../office/paths.js';
import type { AuditService } from './audit-service.js';

export interface EventVolumeRef {
  id: string;
  root: string | null;
}

export interface VolumeDirectory {
  defaultHot(): EventVolumeRef | null;
  get(id: string): EventVolumeRef | null;
}

export interface EventServiceDeps {
  db: Database;
  paths: OfficePaths;
  volumes: VolumeDirectory;
  audit: AuditService;
  bus: EventBus;
  logger: Logger;
  clock?: () => Date;
}

export class EventService {
  private readonly clock: () => Date;

  constructor(private readonly deps: EventServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  list(query: ListQuery): Page<EventSummary> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (query.state) {
      clauses.push('e.state = ?');
      params.push(query.state);
    }
    if (query.q && query.q.trim().length > 0) {
      clauses.push('e.title LIKE ?');
      params.push(`%${query.q.trim()}%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const total =
      this.deps.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM events e ${where}`, ...params)
        ?.count ?? 0;
    const rows = this.deps.db.all<EventRow>(
      `SELECT e.*,
        (SELECT COUNT(*) FROM assets a WHERE a.event_id = e.id) AS asset_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.event_id = e.id) AS job_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.event_id = e.id
          AND j.state IN ('queued','running','blocked','blocked_offline','interrupted','review_pending')) AS open_job_count
       FROM events e
       ${where}
       ORDER BY e.occurred_at DESC, e.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      query.limit,
      query.offset,
    );
    return {
      items: rows.map(mapEventRow),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  get(id: string): EventDetail {
    const row = this.getRow(id);
    const assets = this.deps.db.all<AssetRow>(
      'SELECT * FROM assets WHERE event_id = ? ORDER BY created_at ASC',
      id,
    );
    const jobs = this.deps.db.all<JobRow>(
      `SELECT j.*, e.title AS event_title, s.name AS style_name
       FROM jobs j JOIN events e ON e.id = j.event_id
       LEFT JOIN styles s ON s.id = j.style_id
       WHERE j.event_id = ? ORDER BY j.created_at ASC`,
      id,
    );
    const reviews = this.deps.db.all<ReviewRow>(
      `SELECT r.* FROM reviews r JOIN jobs j ON j.id = r.job_id
       WHERE j.event_id = ? ORDER BY r.created_at ASC`,
      id,
    );
    const publications = this.deps.db.all<PublicationRow>(
      `SELECT p.* FROM publications p JOIN jobs j ON j.id = p.job_id
       WHERE j.event_id = ? ORDER BY p.published_at ASC`,
      id,
    );
    return {
      ...mapEventRow(row),
      assets: assets.map(mapAssetRow),
      jobs: jobs.map(mapJobRow),
      reviews: reviews.map(mapReviewRow),
      publications: publications.map(mapPublicationRow),
      manifest: this.readManifest(row),
    };
  }

  create(input: CreateEventRequest, actorId: string | null): EventDetail {
    const date = parseDateOnly(input.occurredAt);
    const volume = this.deps.volumes.defaultHot();
    const slug = this.uniqueSlug(input.slug ?? ensureSlug(input.title, input.kind), date, input.kind);
    const relPath = eventRelPath({ occurredAt: date, kind: input.kind, slug });
    const id = newId('evt');
    const now = this.clock().toISOString();

    if (volume?.root) {
      ensureEventDirs(volume.root, relPath);
    }

    this.deps.db.run(
      `INSERT INTO events
        (id, kind, title, title_slug, occurred_at, state, owner_id, volume_id, rel_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.kind,
      input.title,
      slug,
      input.occurredAt,
      'draft',
      input.ownerId ?? actorId ?? 'usr_local',
      volume?.id ?? null,
      relPath,
      now,
      now,
    );

    const created = this.get(id);
    this.writeManifest(created);
    this.deps.audit.record({
      actorId,
      action: 'event.create',
      entity: 'event',
      entityId: id,
      after: { title: input.title, kind: input.kind, occurredAt: input.occurredAt, slug },
    });
    this.deps.bus.publish({ type: 'event.updated', eventId: id, state: 'draft' });
    this.deps.logger.info('event.created', { eventId: id, kind: input.kind });
    return this.get(id);
  }

  update(id: string, patch: UpdateEventRequest, actorId: string | null): EventDetail {
    const before = this.get(id);
    const assetCount = this.deps.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM assets WHERE event_id = ?',
      id,
    );
    if (
      (patch.kind !== undefined && patch.kind !== before.kind) ||
      (patch.occurredAt !== undefined && patch.occurredAt !== before.occurredAt)
    ) {
      if ((assetCount?.count ?? 0) > 0) {
        throw new AppError('WS-4001', { reason: 'cannot_change_path_after_assets' });
      }
    }

    const nextKind = patch.kind ?? before.kind;
    const nextDate = patch.occurredAt ?? before.occurredAt;
    const nextTitle = patch.title ?? before.title;
    let nextRel = before.relPath;
    if (nextKind !== before.kind || nextDate !== before.occurredAt) {
      const date = parseDateOnly(nextDate);
      nextRel = eventRelPath({ occurredAt: date, kind: nextKind, slug: before.slug });
    }
    this.deps.db.run(
      `UPDATE events SET kind = ?, title = ?, occurred_at = ?, owner_id = ?, rel_path = ?, updated_at = ?
       WHERE id = ?`,
      nextKind,
      nextTitle,
      nextDate,
      patch.ownerId === undefined ? before.ownerId : patch.ownerId,
      nextRel,
      this.clock().toISOString(),
      id,
    );
    const updated = this.get(id);
    this.writeManifest(updated);
    this.deps.audit.record({
      actorId,
      action: 'event.update',
      entity: 'event',
      entityId: id,
      before: { title: before.title, kind: before.kind, occurredAt: before.occurredAt },
      after: { title: updated.title, kind: updated.kind, occurredAt: updated.occurredAt },
    });
    return updated;
  }

  transition(
    id: string,
    to: EventState,
    options: { actorId: string | null; reason?: string; elevated?: boolean },
  ): EventDetail {
    const current = this.getRow(id);
    assertEventTransition(current.state as EventState, to);

    if (to === 'published') {
      const approved = this.deps.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM jobs j
         JOIN reviews r ON r.job_id = j.id
         WHERE j.event_id = ? AND r.decision = 'approved' AND j.state IN ('approved','published')`,
        id,
      );
      if ((approved?.count ?? 0) === 0) {
        throw new AppError('WS-4001', { reason: 'no_approved_job' });
      }
    }
    if (to === 'archived' || to === 'cold') {
      const open = this.deps.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM jobs WHERE event_id = ?
         AND state IN ('queued','running','blocked','blocked_offline','interrupted','review_pending')`,
        id,
      );
      if ((open?.count ?? 0) > 0) throw new AppError('WS-4002', { openJobs: open?.count });
    }

    const now = this.clock().toISOString();
    this.deps.db.run('UPDATE events SET state = ?, updated_at = ? WHERE id = ?', to, now, id);
    this.deps.audit.record({
      actorId: options.actorId,
      action: 'event.transition',
      entity: 'event',
      entityId: id,
      before: { state: current.state },
      after: { state: to, reason: options.reason ?? null },
      elevated: options.elevated ?? false,
    });
    this.writeManifest(this.get(id));
    this.deps.bus.publish({ type: 'event.updated', eventId: id, state: to });
    return this.get(id);
  }

  /** تُستدعى بعد تغيّر وظائف الحدث؛ تتجاهل الانتقالات غير المسموحة. */
  recompute(id: string): void {
    const row = this.getRow(id);
    const jobs = this.deps.db.all<{ state: string }>('SELECT state FROM jobs WHERE event_id = ?', id);
    if (jobs.length === 0) return;
    const states = jobs.map((job) => job.state);
    let target: EventState | null = null;
    if (states.some((state) => state === 'running')) target = 'in_progress';
    else if (states.some((state) => state === 'review_pending')) target = 'in_review';
    else if (states.every((state) => ['approved', 'published', 'archived'].includes(state))) {
      target = 'approved';
    } else if (states.every((state) => ['succeeded', 'approved', 'published', 'archived', 'rejected'].includes(state))) {
      target = 'edited';
    }
    if (!target || target === row.state) return;
    if (!canTransition(EVENT_TRANSITIONS, row.state as EventState, target)) return;
    const now = this.clock().toISOString();
    this.deps.db.run('UPDATE events SET state = ?, updated_at = ? WHERE id = ?', target, now, id);
    this.deps.bus.publish({ type: 'event.updated', eventId: id, state: target });
    this.writeManifest(this.get(id));
  }

  writeManifest(event: EventDetail): void {
    if (!event.volumeId || !event.relPath) return;
    const volume = this.deps.volumes.get(event.volumeId);
    if (!volume?.root) return;
    const dir = this.deps.paths.resolveInside(volume.root, event.relPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const manifest = {
      schema: 1,
      event_id: event.id,
      kind: event.kind,
      title: event.title,
      occurred_at: event.occurredAt,
      state: event.state,
      jobs: event.jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        style: job.styleId,
        state: job.state,
      })),
      assets: event.assets.map((asset) => ({
        sha256: asset.sha256,
        path: stripEventPrefix(event.relPath as string, asset.relPath),
        kind: asset.kind,
        bytes: asset.bytes,
      })),
    };
    writeJsonAtomic(join(dir, 'manifest.json'), manifest);
  }

  getRow(id: string): EventRow {
    const row = this.deps.db.get<EventRow>(
      `SELECT e.*,
        (SELECT COUNT(*) FROM assets a WHERE a.event_id = e.id) AS asset_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.event_id = e.id) AS job_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.event_id = e.id
          AND j.state IN ('queued','running','blocked','blocked_offline','interrupted','review_pending')) AS open_job_count
       FROM events e WHERE e.id = ?`,
      id,
    );
    if (!row) throw new AppError('WS-0002', { eventId: id });
    return row;
  }

  getOrThrow(id: string): EventDetail {
    return this.get(id);
  }

  private readManifest(row: EventRow): Record<string, unknown> | null {
    if (!row.volume_id || !row.rel_path) return null;
    const volume = this.deps.volumes.get(row.volume_id);
    if (!volume?.root) return null;
    const file = join(this.deps.paths.resolveInside(volume.root, row.rel_path), 'manifest.json');
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private uniqueSlug(base: string, date: Date, kind: string): string {
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 34)}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = this.deps.db.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM events WHERE occurred_at = ? AND title_slug = ? AND kind = ?',
        stamp,
        candidate,
        kind,
      );
      if ((exists?.count ?? 0) === 0) return candidate;
    }
    return `${base.slice(0, 30)}-${Date.now().toString(36).slice(-5)}`;
  }
}

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new AppError('WS-0003', { field: 'occurredAt' });
  return date;
}

function ensureEventDirs(root: string, relPath: string): void {
  const base = join(root, ...normalizeRel(relPath).split('/'));
  for (const dir of ['source', 'work', 'output', 'review']) {
    mkdirSync(join(base, dir), { recursive: true });
  }
}

function stripEventPrefix(eventRel: string, assetRel: string): string {
  if (assetRel.startsWith(`${eventRel}/`)) return assetRel.slice(eventRel.length + 1);
  return assetRel;
}

interface EventRow {
  id: string;
  kind: string;
  title: string;
  title_slug: string;
  occurred_at: string;
  state: string;
  owner_id: string | null;
  volume_id: string | null;
  rel_path: string | null;
  created_at: string;
  updated_at: string;
  asset_count: number;
  job_count: number;
  open_job_count: number;
}

interface AssetRow {
  id: string;
  event_id: string;
  sha256: string;
  volume_id: string;
  rel_path: string;
  kind: string;
  bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  captured_at: string | null;
  status: string;
  duplicate_of: string | null;
  created_at: string;
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
  state: string;
  priority: number;
  progress: number;
  step: string | null;
  attempts: number;
  max_attempts: number;
  max_minutes: number;
  error_code: string | null;
  error_message: string | null;
  result_json: string | null;
  workspace_rel: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
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

export function mapEventRow(row: EventRow): EventSummary {
  return {
    id: row.id,
    kind: row.kind as EventSummary['kind'],
    title: row.title,
    slug: row.title_slug,
    occurredAt: row.occurred_at,
    state: row.state as EventSummary['state'],
    ownerId: row.owner_id,
    volumeId: row.volume_id,
    relPath: row.rel_path,
    assetCount: row.asset_count,
    jobCount: row.job_count,
    openJobCount: row.open_job_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAssetRow(row: AssetRow): Asset {
  return {
    id: row.id,
    eventId: row.event_id,
    sha256: row.sha256,
    volumeId: row.volume_id,
    relPath: row.rel_path,
    kind: row.kind as Asset['kind'],
    bytes: row.bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    status: row.status as Asset['status'],
    duplicateOf: row.duplicate_of,
    createdAt: row.created_at,
  };
}

export function mapJobRow(row: JobRow): JobSummary {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    kind: row.kind as JobSummary['kind'],
    mode: row.mode as JobSummary['mode'],
    styleId: row.style_id,
    styleName: row.style_name,
    styleVersion: row.style_version,
    state: row.state as JobSummary['state'],
    priority: row.priority,
    progress: row.progress,
    step: row.step,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    maxMinutes: row.max_minutes,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    resultJson: row.result_json,
    workspaceRel: row.workspace_rel,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function mapReviewRow(row: ReviewRow): Review {
  return {
    id: row.id,
    jobId: row.job_id,
    reviewerId: row.reviewer_id,
    decision: row.decision as Review['decision'],
    checklist: safeJson<Record<string, boolean>>(row.checklist_json, {}),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function mapPublicationRow(row: PublicationRow): Publication {
  return {
    id: row.id,
    jobId: row.job_id,
    platform: row.platform,
    url: row.url,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
  };
}

export function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
