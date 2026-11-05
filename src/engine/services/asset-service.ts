import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { Asset } from '../../shared/models.js';
import { joinRel } from '../../shared/paths.js';
import type { Database } from '../db/database.js';
import type { OfficePaths } from '../office/paths.js';
import { copyFileWithHash, hashFile } from '../util/files.js';
import type { Logger } from '../util/logger.js';
import type { AuditService } from './audit-service.js';
import type { EventService } from './event-service.js';
import type { MoveJournalService } from './move-journal-service.js';
import { mapAssetRow } from './event-service.js';
import type { VolumeService } from './volume-service.js';

export interface AssetServiceDeps {
  db: Database;
  paths: OfficePaths;
  volumes: VolumeService;
  events: EventService;
  journal: MoveJournalService;
  audit: AuditService;
  logger: Logger;
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

export class AssetService {
  constructor(private readonly deps: AssetServiceDeps) {}

  /**
   * ينقل/ينسخ أصلًا بين حدثين مع التحقق. النقل داخل نفس القرص rename ذرّي،
   * وبين قرصين نسخ → هاش → ثم حذف المصدر.
   */
  async relocate(
    assetId: string,
    targetEventId: string,
    mode: 'copy' | 'move',
    actorId: string | null,
  ): Promise<Asset> {
    const asset = this.getAsset(assetId);
    if (asset.eventId === targetEventId) throw new AppError('WS-0003', { reason: 'same_event' });
    const sourceEvent = this.deps.events.get(asset.eventId);
    const targetEvent = this.deps.events.get(targetEventId);
    if (!sourceEvent.volumeId || !sourceEvent.relPath) throw new AppError('WS-2002', { eventId: sourceEvent.id });
    if (!targetEvent.volumeId || !targetEvent.relPath) throw new AppError('WS-2002', { eventId: targetEvent.id });
    const sourceVolume = this.deps.volumes.get(sourceEvent.volumeId);
    const targetVolume = this.deps.volumes.get(targetEvent.volumeId);
    if (!sourceVolume?.root) throw new AppError('WS-2002', { volumeId: sourceEvent.volumeId });
    if (!targetVolume?.root) throw new AppError('WS-2002', { volumeId: targetEvent.volumeId });

    const sourcePath = this.deps.paths.resolveInside(sourceVolume.root, asset.relPath);
    if (!existsSync(sourcePath)) throw new AppError('WS-0002', { reason: 'asset_file_missing' });
    const actualHash = await hashFile(sourcePath);
    if (actualHash !== asset.sha256) throw new AppError('WS-3003', { reason: 'asset_hash_mismatch' });

    const targetName = uniqueTargetName(
      targetVolume.root,
      targetEvent.relPath,
      basename(asset.relPath),
    );
    const targetRel = joinRel(targetEvent.relPath, 'source', targetName);
    const targetPath = this.deps.paths.resolveInside(targetVolume.root, targetRel);
    mkdirSync(dirname(targetPath), { recursive: true });

    const sameVolume = sourceVolume.id === targetVolume.id;
    if (sameVolume && mode === 'move') {
      try {
        renameSync(sourcePath, targetPath);
      } catch (error) {
        throw new AppError('WS-3002', { reason: 'relocate_failed' }, error);
      }
    } else {
      const copied = await copyFileWithHash(sourcePath, targetPath);
      if (copied.sha256 !== asset.sha256) throw new AppError('WS-3003', { reason: 'relocate_hash_mismatch' });
      if (mode === 'move') {
        try {
          unlinkSync(sourcePath);
        } catch (error) {
          this.deps.logger.warn('asset.relocate_delete_failed', { assetId, error: String(error) });
        }
      }
    }

    const now = new Date().toISOString();
    let resultId = asset.id;
    if (mode === 'move') {
      this.deps.db.run(
        'UPDATE assets SET event_id = ?, volume_id = ?, rel_path = ? WHERE id = ?',
        targetEvent.id,
        targetVolume.id,
        targetRel,
        asset.id,
      );
      this.deps.db.run('DELETE FROM placements WHERE asset_id = ? AND role = ?', asset.id, 'primary');
      this.deps.db.run(
        `INSERT INTO placements (asset_id, volume_id, rel_path, role, verified_at, created_at)
         VALUES (?, ?, ?, 'primary', ?, ?)`,
        asset.id,
        targetVolume.id,
        targetRel,
        now,
        now,
      );
      this.deps.journal.record({
        assetId: asset.id,
        sourcePath,
        targetVolumeId: targetVolume.id,
        targetRelPath: targetRel,
        sha256: asset.sha256,
        bytes: asset.bytes,
        mode: 'move',
        action: 'relocate',
      });
    } else {
      resultId = newId('ast');
      this.deps.db.run(
        `INSERT INTO assets
          (id, event_id, sha256, volume_id, rel_path, kind, bytes, status, duplicate_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'present', ?, ?)`,
        resultId,
        targetEvent.id,
        asset.sha256,
        targetVolume.id,
        targetRel,
        asset.kind,
        asset.bytes,
        asset.id,
        now,
      );
      this.deps.db.run(
        `INSERT INTO placements (asset_id, volume_id, rel_path, role, verified_at, created_at)
         VALUES (?, ?, ?, 'primary', ?, ?)`,
        resultId,
        targetVolume.id,
        targetRel,
        now,
        now,
      );
    }

    this.deps.events.writeManifest(this.deps.events.get(sourceEvent.id));
    this.deps.events.writeManifest(this.deps.events.get(targetEvent.id));
    this.deps.audit.record({
      actorId,
      action: mode === 'move' ? 'asset.relocate' : 'asset.copy_to_event',
      entity: 'asset',
      entityId: resultId,
      before: { eventId: sourceEvent.id, relPath: asset.relPath },
      after: { eventId: targetEvent.id, relPath: targetRel, mode },
    });
    return this.getAsset(resultId);
  }

  /**
   * يحذف الخام فقط إن وُجد مخرَج محفوظ، وينقله إلى 90_trash لا إلى العدم.
   */
  trashSources(
    eventId: string,
    confirmTitle: string,
    actorId: string | null,
  ): { moved: number; bytes: number; trashRel: string } {
    const event = this.deps.events.get(eventId);
    if (confirmTitle.trim() !== event.title.trim()) {
      throw new AppError('WS-0003', { reason: 'confirmation_mismatch' });
    }
    if (!event.volumeId || !event.relPath) throw new AppError('WS-2002', { eventId });
    const outputCount = this.deps.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE event_id = ? AND result_json IS NOT NULL
       AND state IN ('review_pending','approved','published','archived')`,
      eventId,
    );
    if ((outputCount?.count ?? 0) === 0) {
      throw new AppError('WS-0006', { reason: 'no_saved_outputs' });
    }
    const volume = this.deps.volumes.get(event.volumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId: event.volumeId });

    const assets = this.deps.db.all<AssetRow>(
      "SELECT * FROM assets WHERE event_id = ? AND status = 'present'",
      eventId,
    );
    const trashRel = joinRel('90_trash', `${eventId}-sources-${Date.now()}`);
    const trashDir = this.deps.paths.resolveInside(volume.root, trashRel);
    mkdirSync(trashDir, { recursive: true });
    let moved = 0;
    let bytes = 0;
    for (const asset of assets) {
      const sourceVolume = this.deps.volumes.get(asset.volume_id);
      if (!sourceVolume?.root) continue;
      const source = this.deps.paths.resolveInside(sourceVolume.root, asset.rel_path);
      if (!existsSync(source)) continue;
      const destination = join(trashDir, basename(source));
      try {
        renameSync(source, destination);
        this.deps.db.run("UPDATE assets SET status = 'trashed' WHERE id = ?", asset.id);
        moved += 1;
        bytes += asset.bytes;
      } catch (error) {
        this.deps.logger.warn('asset.trash_failed', { assetId: asset.id, error: String(error) });
      }
    }
    this.deps.events.writeManifest(this.deps.events.get(eventId));
    this.deps.audit.record({
      actorId,
      action: 'event.sources_trashed',
      entity: 'event',
      entityId: eventId,
      after: { moved, bytes, trashRel },
      elevated: true,
    });
    return { moved, bytes, trashRel };
  }

  getAsset(id: string): Asset {
    const row = this.deps.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', id);
    if (!row) throw new AppError('WS-0002', { assetId: id });
    return mapAssetRow(row);
  }
}

function uniqueTargetName(volumeRoot: string, eventRel: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot) : extname(name);
  const base = dot >= 0 ? name.slice(0, dot) : name;
  let candidate = name;
  let suffix = 2;
  while (existsSync(join(volumeRoot, ...eventRel.split('/'), 'source', candidate))) {
    candidate = `${base}-${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}
