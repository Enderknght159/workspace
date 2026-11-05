import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { MoveJournalEntry } from '../../shared/models.js';
import type { Database } from '../db/database.js';
import type { OfficePaths } from '../office/paths.js';
import { copyFileWithHash, hashFile } from '../util/files.js';
import type { Logger } from '../util/logger.js';
import type { AuditService } from './audit-service.js';
import type { VolumeService } from './volume-service.js';

export interface MoveJournalDeps {
  db: Database;
  paths: OfficePaths;
  volumes: VolumeService;
  audit: AuditService;
  logger: Logger;
}

interface MoveRow {
  id: string;
  asset_id: string | null;
  source_path: string;
  target_volume_id: string;
  target_rel_path: string;
  sha256: string;
  bytes: number;
  mode: string;
  action: string;
  state: string;
  created_at: string;
  undone_at: string | null;
}

/**
 * سجل النقل الآمن. `source_path` مسار مطلق خاص بالجهاز (بطاقة/قرص)،
 * وليس جزءًا من كتالوج الأصول المحمول. يُستخدم للتراجع فقط.
 */
export class MoveJournalService {
  constructor(private readonly deps: MoveJournalDeps) {}

  record(input: {
    assetId: string | null;
    sourcePath: string;
    targetVolumeId: string;
    targetRelPath: string;
    sha256: string;
    bytes: number;
    mode: 'copy' | 'move';
    action: 'ingest' | 'relocate' | 'undo';
  }): MoveJournalEntry {
    const id = newId('mov');
    const at = new Date().toISOString();
    this.deps.db.run(
      `INSERT INTO move_journal
        (id, asset_id, source_path, target_volume_id, target_rel_path, sha256, bytes, mode, action, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      id,
      input.assetId,
      input.sourcePath,
      input.targetVolumeId,
      input.targetRelPath,
      input.sha256,
      input.bytes,
      input.mode,
      input.action,
      at,
    );
    return this.get(id);
  }

  get(id: string): MoveJournalEntry {
    const row = this.deps.db.get<MoveRow>('SELECT * FROM move_journal WHERE id = ?', id);
    if (!row) throw new AppError('WS-0002', { moveId: id });
    return mapRow(row);
  }

  list(limit = 100): MoveJournalEntry[] {
    return this.deps.db
      .all<MoveRow>('SELECT * FROM move_journal ORDER BY created_at DESC LIMIT ?', limit)
      .map(mapRow);
  }

  latestForAsset(assetId: string): MoveJournalEntry | null {
    const row = this.deps.db.get<MoveRow>(
      'SELECT * FROM move_journal WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1',
      assetId,
    );
    return row ? mapRow(row) : null;
  }

  /** يعيد الملف من المكتب إلى مساره الأصلي بعد التحقق. لا يحذف نسخة المكتب. */
  async undo(id: string, actorId: string | null): Promise<MoveJournalEntry> {
    const entry = this.get(id);
    if (entry.state === 'undone') throw new AppError('WS-0006', { reason: 'already_undone' });
    const volume = this.deps.volumes.get(entry.targetVolumeId);
    if (!volume?.root) throw new AppError('WS-2002', { volumeId: entry.targetVolumeId });
    const target = this.deps.paths.resolveInside(volume.root, entry.targetRelPath);
    if (!existsSync(target)) throw new AppError('WS-0002', { reason: 'target_missing' });

    const targetHash = await hashFile(target);
    if (targetHash !== entry.sha256) {
      throw new AppError('WS-3003', { reason: 'target_changed' });
    }
    if (existsSync(entry.sourcePath)) {
      throw new AppError('WS-3006', { sourcePath: entry.sourcePath });
    }
    const sourceParent = dirname(entry.sourcePath);
    const driveRoot = `${entry.sourcePath.slice(0, 2)}\\`;
    if (!existsSync(driveRoot)) throw new AppError('WS-3007', { sourcePath: entry.sourcePath });
    mkdirSync(sourceParent, { recursive: true });
    const copied = await copyFileWithHash(target, entry.sourcePath);
    if (copied.sha256 !== entry.sha256) {
      try {
        unlinkSync(entry.sourcePath);
      } catch {
        // تجاهل.
      }
      throw new AppError('WS-3003', { reason: 'undo_hash_mismatch' });
    }
    const now = new Date().toISOString();
    this.deps.db.run('UPDATE move_journal SET state = ?, undone_at = ? WHERE id = ?', 'undone', now, id);
    this.deps.audit.record({
      actorId,
      action: 'move.undo',
      entity: 'asset',
      entityId: entry.assetId ?? id,
      after: { moveId: id, sourcePath: entry.sourcePath },
      elevated: true,
    });
    this.deps.logger.info('move.undone', { moveId: id, sourcePath: entry.sourcePath });
    return this.get(id);
  }
}

function mapRow(row: MoveRow): MoveJournalEntry {
  return {
    id: row.id,
    assetId: row.asset_id,
    sourcePath: row.source_path,
    targetVolumeId: row.target_volume_id,
    targetRelPath: row.target_rel_path,
    sha256: row.sha256,
    bytes: row.bytes,
    mode: row.mode as MoveJournalEntry['mode'],
    action: row.action as MoveJournalEntry['action'],
    state: row.state as MoveJournalEntry['state'],
    createdAt: row.created_at,
    undoneAt: row.undone_at,
  };
}

export { join };
