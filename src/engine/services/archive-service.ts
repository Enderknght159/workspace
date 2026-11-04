import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { ArchiveCandidate, ArchiveItemResult, ArchiveReport } from '../../shared/models.js';
import type { Database } from '../db/database.js';
import type { OfficePaths } from '../office/paths.js';
import { copyFileWithHash } from '../util/files.js';
import type { Logger } from '../util/logger.js';
import type { AuditService } from './audit-service.js';
import type { EventService } from './event-service.js';
import type { SettingsService } from './settings-service.js';
import type { VolumeService } from './volume-service.js';

export interface ArchiveServiceDeps {
  db: Database;
  paths: OfficePaths;
  volumes: VolumeService;
  events: EventService;
  settings: SettingsService;
  audit: AuditService;
  logger: Logger;
}

interface ArchiveRow {
  id: string;
  title: string;
  rel_path: string;
  volume_id: string;
  published_at: string | null;
  updated_at: string;
  asset_count: number;
  bytes: number;
  open_jobs: number;
}

interface AssetRow {
  id: string;
  rel_path: string;
  sha256: string;
  bytes: number;
  volume_id: string;
}

export class ArchiveService {
  constructor(private readonly deps: ArchiveServiceDeps) {}

  candidates(): ArchiveCandidate[] {
    const settings = this.deps.settings.get();
    const cutoff = Date.now() - settings.archive.retentionDays * 86_400_000;
    const rows = this.deps.db.all<ArchiveRow>(
      `SELECT e.id, e.title, e.rel_path, e.volume_id, e.updated_at,
        (SELECT MAX(p.published_at) FROM publications p JOIN jobs j ON j.id = p.job_id
          WHERE j.event_id = e.id) AS published_at,
        (SELECT COUNT(*) FROM assets a WHERE a.event_id = e.id AND a.status = 'present') AS asset_count,
        (SELECT COALESCE(SUM(a.bytes), 0) FROM assets a WHERE a.event_id = e.id AND a.status = 'present') AS bytes,
        (SELECT COUNT(*) FROM jobs j WHERE j.event_id = e.id
          AND j.state IN ('queued','running','blocked','blocked_offline','interrupted','review_pending')) AS open_jobs
       FROM events e
       WHERE e.state = 'published' AND e.rel_path IS NOT NULL AND e.volume_id IS NOT NULL
       ORDER BY e.updated_at ASC`,
    );
    return rows
      .filter((row) => row.open_jobs === 0)
      .filter((row) => {
        const published = row.published_at ? Date.parse(row.published_at) : Date.parse(row.updated_at);
        return Number.isFinite(published) && published <= cutoff;
      })
      .map((row) => ({
        eventId: row.id,
        title: row.title,
        publishedAt: row.published_at,
        assetCount: row.asset_count,
        bytes: row.bytes,
        openJobs: row.open_jobs,
      }));
  }

  async run(options: {
    targetVolumeId: string;
    dryRun: boolean;
    eventIds?: string[];
    actorId: string | null;
  }): Promise<ArchiveReport> {
    const target = this.deps.volumes.get(options.targetVolumeId);
    if (!target) throw new AppError('WS-2001', { volumeId: options.targetVolumeId });
    if (target.kind !== 'cold') throw new AppError('WS-7001', { reason: 'not_a_cold_volume' });
    if (target.status !== 'connected' || !target.root) throw new AppError('WS-7001');
    const coldRoot = join(target.root, 'WorkspaceCold');
    mkdirSync(coldRoot, { recursive: true });

    const candidates = this.candidates().filter(
      (candidate) => !options.eventIds || options.eventIds.includes(candidate.eventId),
    );
    const items: ArchiveItemResult[] = [];
    let copied = 0;
    let failed = 0;
    let bytes = 0;

    for (const candidate of candidates) {
      const result = await this.archiveEvent(candidate, target.id, coldRoot, options.dryRun, options.actorId);
      items.push(result);
      if (result.status === 'copied') {
        copied += 1;
        bytes += result.bytes;
      } else if (result.status === 'failed') {
        failed += 1;
      }
    }

    this.deps.audit.record({
      actorId: options.actorId,
      action: 'archive.run',
      entity: 'volume',
      entityId: target.id,
      after: { dryRun: options.dryRun, copied, failed, bytes },
      elevated: true,
    });
    return {
      dryRun: options.dryRun,
      targetVolumeId: target.id,
      items,
      copied,
      failed,
      bytes,
    };
  }

  private async archiveEvent(
    candidate: ArchiveCandidate,
    targetVolumeId: string,
    coldRoot: string,
    dryRun: boolean,
    actorId: string | null,
  ): Promise<ArchiveItemResult> {
    const base: ArchiveItemResult = {
      eventId: candidate.eventId,
      title: candidate.title,
      status: 'skipped',
      assets: 0,
      bytes: 0,
      error: null,
    };
    const event = this.deps.db.get<{ rel_path: string; volume_id: string }>(
      'SELECT rel_path, volume_id FROM events WHERE id = ?',
      candidate.eventId,
    );
    if (!event) return { ...base, status: 'failed', error: 'الحدث غير موجود' };
    const sourceVolume = this.deps.volumes.get(event.volume_id);
    if (!sourceVolume?.root) return { ...base, status: 'failed', error: 'قرص المصدر غير موصول' };

    const assets = this.deps.db.all<AssetRow>(
      "SELECT id, rel_path, sha256, bytes, volume_id FROM assets WHERE event_id = ? AND status = 'present'",
      candidate.eventId,
    );

    if (dryRun) {
      return { ...base, status: 'copied', assets: assets.length, bytes: candidate.bytes };
    }

    try {
      for (const asset of assets) {
        const sourceFile = this.resolveAsset(asset.volume_id, asset.rel_path);
        const destination = join(coldRoot, ...asset.rel_path.split('/'));
        if (existsSync(destination) && statSync(destination).size === asset.bytes) {
          // نعيد الكتابة والتحقق دائمًا؛ الأرشيف لا يُفترض سلامته بالحجم وحده.
        }
        const copiedFile = await copyFileWithHash(sourceFile, destination);
        if (copiedFile.sha256 !== asset.sha256) {
          throw new AppError('WS-7002', {
            assetId: asset.id,
            expected: asset.sha256,
            actual: copiedFile.sha256,
          });
        }
        const now = new Date().toISOString();
        this.deps.db.run(
          `INSERT INTO archive_moves
            (id, asset_id, from_volume_id, to_volume_id, rel_path, sha256, status, verified_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?)`,
          newId('arc'),
          asset.id,
          asset.volume_id,
          targetVolumeId,
          asset.rel_path,
          asset.sha256,
          now,
          now,
        );
        this.deps.db.run(
          `INSERT INTO placements (asset_id, volume_id, rel_path, role, verified_at, created_at)
           VALUES (?, ?, ?, 'replica', ?, ?)
           ON CONFLICT(asset_id, volume_id, rel_path) DO UPDATE SET verified_at = excluded.verified_at`,
          asset.id,
          targetVolumeId,
          asset.rel_path,
          now,
          now,
        );
      }

      appendFileSync(
        join(coldRoot, 'catalog.jsonl'),
        `${JSON.stringify({
          event_id: candidate.eventId,
          title: candidate.title,
          rel_path: event.rel_path,
          assets: assets.length,
          bytes: candidate.bytes,
          archived_at: new Date().toISOString(),
        })}\n`,
        'utf8',
      );

      this.deps.events.transition(candidate.eventId, 'archived', {
        actorId,
        reason: 'archive verified',
        elevated: true,
      });
      this.deps.events.transition(candidate.eventId, 'cold', { actorId, reason: 'archive complete' });

      if (this.deps.settings.get().archive.trashAfterArchive) {
        const sourceDir = this.resolveEventDir(event.volume_id, event.rel_path);
        const trashDir = join(sourceVolume.root, '90_trash', `${candidate.eventId}-${Date.now()}`);
        mkdirSync(join(sourceVolume.root, '90_trash'), { recursive: true });
        try {
          renameSync(sourceDir, trashDir);
          this.deps.db.run(
            "UPDATE assets SET status = 'archived' WHERE event_id = ? AND status = 'present'",
            candidate.eventId,
          );
        } catch (error) {
          this.deps.logger.warn('archive.trash_failed', {
            eventId: candidate.eventId,
            error: String(error),
          });
        }
      }

      return { ...base, status: 'copied', assets: assets.length, bytes: candidate.bytes };
    } catch (error) {
      const appError = AppError.from(error);
      this.deps.logger.error('archive.failed', {
        eventId: candidate.eventId,
        code: appError.code,
        error: appError.message,
      });
      return { ...base, status: 'failed', error: appError.message };
    }
  }

  purgeTrash(): { removed: number; bytes: number } {
    const days = this.deps.settings.get().archive.trashDays;
    const cutoff = Date.now() - days * 86_400_000;
    let removed = 0;
    let bytes = 0;
    for (const volume of this.deps.volumes.list()) {
      if (volume.kind !== 'hot' || !volume.root) continue;
      const trash = join(volume.root, '90_trash');
      if (!existsSync(trash)) continue;
      for (const entry of readdirSync(trash, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = join(trash, entry.name);
        try {
          const stats = statSync(full);
          if (stats.mtimeMs > cutoff) continue;
          bytes += directoryBytes(full);
          rmSync(full, { recursive: true, force: true });
          removed += 1;
        } catch (error) {
          this.deps.logger.warn('archive.purge_failed', { path: entry.name, error: String(error) });
        }
      }
    }
    this.deps.audit.record({
      actorId: null,
      action: 'archive.purge',
      entity: 'office',
      entityId: 'trash',
      after: { removed, bytes, olderThanDays: days },
      elevated: true,
    });
    return { removed, bytes };
  }

  private resolveAsset(volumeId: string, relPath: string): string {    const volume = this.deps.volumes.get(volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId });
    return this.deps.paths.resolveInside(volume.root, relPath);
  }

  private resolveEventDir(volumeId: string, relPath: string): string {
    const volume = this.deps.volumes.get(volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId });
    return this.deps.paths.resolveInside(volume.root, relPath);
  }
}

function directoryBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else {
      try {
        total += statSync(full).size;
      } catch {
        // تجاهل.
      }
    }
  }
  return total;
}
