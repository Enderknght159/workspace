import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { type AssetKind } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { IngestBatch, IngestPreview } from '../../shared/models.js';
import { ensureSlug, toSlug } from '../../shared/paths.js';
import type { IngestPreviewRequest } from '../../shared/schemas.js';
import type { Database } from '../db/database.js';
import { longPath, type OfficePaths } from '../office/paths.js';
import type { EventBus } from '../util/event-bus.js';
import { copyFileWithHash, walkMediaFiles, type SourceFile } from '../util/files.js';
import type { Logger } from '../util/logger.js';
import { freeBytesAt } from '../services/machine-profile.js';
import type { SettingsService } from '../services/settings-service.js';
import type { AuditService } from '../services/audit-service.js';
import type { EventService } from '../services/event-service.js';
import type { VolumeService } from '../services/volume-service.js';
import { isRemovableSource } from '../services/volume-identity.js';
import type { MoveJournalService } from '../services/move-journal-service.js';

export interface IngestServiceDeps {
  db: Database;
  paths: OfficePaths;
  volumes: VolumeService;
  events: EventService;
  settings: SettingsService;
  audit: AuditService;
  journal: MoveJournalService;
  bus: EventBus;
  logger: Logger;
}

interface BatchRow {
  id: string;
  source_label: string;
  state: string;
  event_id: string | null;
  total_files: number;
  copied_files: number;
  verified_files: number;
  bytes: number;
  deleted_sources: number;
  mode: string;
  source_removable: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface PreparedFile {
  rowId: number;
  file: SourceFile;
  targetName: string;
}

interface PreparedBatch {
  batchId: string;
  eventId: string;
  files: PreparedFile[];
  mode: 'copy' | 'move';
}

export class IngestService {
  private readonly cancelled = new Set<string>();
  private lastProgressAt = 0;

  constructor(private readonly deps: IngestServiceDeps) {}

  async preview(input: IngestPreviewRequest): Promise<IngestPreview> {
    const source = resolve(input.source);
    if (!existsSync(source) || !statSync(source).isDirectory()) {
      throw new AppError('WS-3001', { source });
    }
    if (source === resolve(this.deps.paths.root) || source.startsWith(resolve(this.deps.paths.root) + sep)) {
      throw new AppError('WS-3001', { reason: 'source_inside_office' });
    }

    const files = await walkMediaFiles(source);
    const selection = input.selection ? new Set(input.selection) : null;
    const selected = (file: SourceFile): boolean => !selection || selection.has(file.relPath);
    const selectedFiles = files.filter(selected);
    const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.bytes, 0);

    const volume = this.deps.volumes.defaultHot();
    const freeBytes = volume?.root ? freeBytesAt(volume.root) : null;
    const settings = this.deps.settings.get();
    const blockBytes = settings.ingest.blockBelowGb * 1024 ** 3;
    const warnBytes = settings.ingest.warnBelowGb * 1024 ** 3;
    const maxFileBytes = settings.ingest.maxFileGb * 1024 ** 3;
    const sourceRemovable = isRemovableSource(source);
    const recommendedMode = sourceRemovable ? 'move' : 'copy';
    const mode = input.mode ?? recommendedMode;

    const warnings: string[] = [];
    let blocked = false;
    let blockReason: string | null = null;

    if (files.length === 0) {
      blocked = true;
      blockReason = 'no_media';
    } else if (selectedFiles.length === 0) {
      blocked = true;
      blockReason = 'no_selection';
    }
    if (!volume?.root) {
      blocked = true;
      blockReason = 'no_hot_volume';
      warnings.push('لا يوجد قرص ساخن مسجّل ومتصل.');
    } else if (freeBytes !== null && freeBytes < blockBytes) {
      blocked = true;
      blockReason = 'insufficient_space';
      warnings.push('المساحة الحرة أقل من الحد الأدنى لبدء التفريغ.');
    } else if (freeBytes !== null && freeBytes < warnBytes) {
      warnings.push('المساحة الحرة منخفضة؛ يُنصح بأرشفة مواد قديمة.');
    }
    const oversized = selectedFiles.filter((file) => file.bytes > maxFileBytes);
    if (oversized.length > 0) {
      warnings.push(`${oversized.length} ملف يتجاوز الحجم الأقصى المعلن.`);
    }
    if (files.some((file) => /[^\u0000-\u007f]/.test(file.relPath))) {
      warnings.push('أسماء بعض الملفات غير لاتينية؛ ستُحوَّل إلى أسماء ASCII آمنة داخل المكتب.');
    }
    if (sourceRemovable) {
      warnings.push('المصدر قرص قابل للإزالة؛ يُقترح وضع «نقل».');
    }
    if (mode === 'move') {
      warnings.push('سيُحذف الملف المحدد من المصدر بعد التحقق الكامل من وصوله إلى المكتب.');
    }

    const suggested = suggestEvent(input, source);

    return {
      source,
      files: files.map((file) => ({
        relPath: file.relPath,
        bytes: file.bytes,
        kind: file.kind,
        selected: selected(file),
      })),
      totalFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      selectedFiles: selectedFiles.length,
      selectedBytes,
      duplicates: [],
      suggested,
      freeBytes,
      warnings,
      blocked,
      blockReason,
      sourceRemovable,
      recommendedMode,
    };
  }

  /** للاختبارات وواجهة سطر الأوامر: ينتظر إتمام الدفعة. */
  async run(input: IngestPreviewRequest, actorId: string | null): Promise<IngestBatch> {
    const prepared = await this.prepare(input, actorId);
    await this.process(prepared);
    return this.getBatch(prepared.batchId);
  }

  /** للواجهة: يعيد الدفعة فورًا ويكمل في الخلفية. */
  async start(input: IngestPreviewRequest, actorId: string | null): Promise<IngestBatch> {
    const prepared = await this.prepare(input, actorId);
    void this.process(prepared).catch((error: unknown) => {
      this.deps.logger.error('ingest.background_failed', {
        batchId: prepared.batchId,
        error: String(error),
      });
    });
    return this.getBatch(prepared.batchId);
  }

  cancel(batchId: string): void {
    this.cancelled.add(batchId);
  }

  getBatch(batchId: string): IngestBatch {
    const row = this.deps.db.get<BatchRow>('SELECT * FROM ingest_batches WHERE id = ?', batchId);
    if (!row) throw new AppError('WS-0002', { batchId });
    return mapBatch(row);
  }

  listBatches(limit = 20): IngestBatch[] {
    return this.deps.db
      .all<BatchRow>('SELECT * FROM ingest_batches ORDER BY started_at DESC LIMIT ?', limit)
      .map(mapBatch);
  }

  recoverInterrupted(): void {
    this.deps.db.run(
      `UPDATE ingest_batches
       SET state = 'failed', error = 'توقف التفريغ قبل اكتماله (إغلاق أو انقطاع).',
           finished_at = COALESCE(finished_at, ?)
       WHERE state IN ('previewing','copying','verifying','organizing')`,
      new Date().toISOString(),
    );
  }

  private async prepare(input: IngestPreviewRequest, actorId: string | null): Promise<PreparedBatch> {
    const preview = await this.preview(input);
    if (preview.blocked) {
      if (preview.blockReason === 'no_media') throw new AppError('WS-3005');
      if (preview.blockReason === 'no_selection') throw new AppError('WS-3005', { reason: 'no_selection' });
      if (preview.blockReason === 'insufficient_space') throw new AppError('WS-2005');
      throw new AppError('WS-2001', { reason: preview.blockReason });
    }

    const event = this.deps.events.create(
      {
        kind: preview.suggested.kind,
        title: preview.suggested.title,
        occurredAt: preview.suggested.occurredAt,
        slug: preview.suggested.slug,
      },
      actorId,
    );
    const selected = preview.files.filter((file) => file.selected);
    const mode = input.mode ?? preview.recommendedMode;

    const batchId = newId('bat');
    const startedAt = new Date().toISOString();
    this.deps.db.run(
      `INSERT INTO ingest_batches
        (id, source_label, state, event_id, total_files, copied_files, verified_files, bytes,
         deleted_sources, mode, source_removable, selection_json, started_at)
       VALUES (?, ?, 'copying', ?, ?, 0, 0, ?, 0, ?, ?, ?, ?)`,
      batchId,
      basename(preview.source),
      event.id,
      selected.length,
      preview.selectedBytes,
      mode,
      preview.sourceRemovable ? 1 : 0,
      JSON.stringify(selected.map((file) => file.relPath)),
      startedAt,
    );

    const usedNames = new Set<string>();
    const files: PreparedFile[] = [];
    for (const entry of selected) {
      const targetName = uniqueFileName(entry.relPath, usedNames);
      const result = this.deps.db.run(
        `INSERT INTO ingest_files (batch_id, rel_path, bytes, status, selected)
         VALUES (?, ?, ?, 'pending', 1)`,
        batchId,
        entry.relPath,
        entry.bytes,
      );
      files.push({
        rowId: result.lastInsertRowid,
        file: {
          relPath: entry.relPath,
          absolutePath: join(preview.source, ...entry.relPath.split('/')),
          bytes: entry.bytes,
          kind: entry.kind as AssetKind,
          modifiedAt: new Date(),
        },
        targetName,
      });
    }

    this.publishProgress(batchId, 'copying', 0, selected.length, 0, true);
    this.deps.audit.record({
      actorId,
      action: 'ingest.start',
      entity: 'event',
      entityId: event.id,
      after: {
        batchId,
        files: selected.length,
        bytes: preview.selectedBytes,
        mode,
        sourceRemovable: preview.sourceRemovable,
      },
    });
    return { batchId, eventId: event.id, files, mode };
  }

  private async process(prepared: PreparedBatch): Promise<void> {
    const { batchId, eventId, files, mode } = prepared;
    const event = this.deps.events.get(eventId);
    const volume = event.volumeId ? this.deps.volumes.get(event.volumeId) : null;
    if (!volume?.root || !event.relPath) {
      throw new AppError('WS-2002', { eventId });
    }
    const eventDir = this.deps.paths.resolveInside(volume.root, event.relPath);
    const inboxDir = join(volume.root, '00_inbox', batchId);
    const sourceDir = join(eventDir, 'source');
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    this.deps.db.run("UPDATE ingest_batches SET state = 'copying' WHERE id = ?", batchId);

    let copied = 0;
    let verified = 0;
    let deletedSources = 0;
    let processedBytes = 0;
    let addedAssets = 0;
    const usedDestination = new Set<string>();

    try {
      for (const preparedFile of files) {
        if (this.cancelled.has(batchId)) throw new AppError('WS-5004', { batchId });
        const inboxPath = join(inboxDir, preparedFile.targetName);
        let copyResult: { sha256: string; bytes: number };
        try {
          copyResult = await copyFileWithHash(preparedFile.file.absolutePath, inboxPath, (progress) => {
            this.publishProgress(
              batchId,
              'copying',
              copied,
              files.length,
              processedBytes + progress.bytes,
            );
          });
        } catch (error) {
          this.markFileFailed(preparedFile.rowId, 'فشل النسخ');
          throw error;
        }

        if (copyResult.bytes !== preparedFile.file.bytes) {
          this.markFileFailed(preparedFile.rowId, 'الحجم لا يطابق المصدر');
          throw new AppError('WS-3003', {
            file: preparedFile.file.relPath,
            expected: preparedFile.file.bytes,
            actual: copyResult.bytes,
          });
        }
        copied += 1;
        processedBytes += copyResult.bytes;

        const duplicate = this.deps.db.get<{ id: string; rel_path: string; volume_id: string }>(
          'SELECT id, rel_path, volume_id FROM assets WHERE sha256 = ? LIMIT 1',
          copyResult.sha256,
        );
        if (duplicate) {
          try {
            unlinkSync(inboxPath);
          } catch {
            // تجاهل.
          }
          this.deps.db.run(
            `UPDATE ingest_files SET sha256 = ?, status = 'duplicate', asset_id = ?, message = ? WHERE id = ?`,
            copyResult.sha256,
            duplicate.id,
            'الملف موجود مسبقًا بنفس البصمة',
            preparedFile.rowId,
          );
          if (mode === 'move') {
            deletedSources += this.deleteSource(
              batchId,
              preparedFile,
              duplicate.id,
              duplicate.volume_id,
              duplicate.rel_path,
              copyResult.sha256,
              copyResult.bytes,
              deletedSources,
            );
          }
          this.publishProgress(batchId, 'verifying', copied, files.length, processedBytes, true);
          continue;
        }

        const destinationName = uniqueDestination(preparedFile.targetName, usedDestination);
        const destination = join(sourceDir, destinationName);
        moveFile(inboxPath, destination);

        const targetRel = `${event.relPath}/source/${destinationName}`;
        const assetId = newId('ast');
        const now = new Date().toISOString();
        this.deps.db.run(
          `INSERT INTO assets
            (id, event_id, sha256, volume_id, rel_path, kind, bytes, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'present', ?)`,
          assetId,
          eventId,
          copyResult.sha256,
          volume.id,
          targetRel,
          preparedFile.file.kind,
          copyResult.bytes,
          now,
        );
        this.deps.db.run(
          `INSERT INTO placements (asset_id, volume_id, rel_path, role, verified_at, created_at)
           VALUES (?, ?, ?, 'primary', ?, ?)`,
          assetId,
          volume.id,
          targetRel,
          now,
          now,
        );
        this.deps.db.run(
          `UPDATE ingest_files SET sha256 = ?, status = 'verified', asset_id = ? WHERE id = ?`,
          copyResult.sha256,
          assetId,
          preparedFile.rowId,
        );
        verified += 1;
        addedAssets += 1;

        if (mode === 'move') {
          deletedSources = this.deleteSource(
            batchId,
            preparedFile,
            assetId,
            volume.id,
            targetRel,
            copyResult.sha256,
            copyResult.bytes,
            deletedSources,
          );
        }

        this.updateBatchCounters(batchId, copied, verified, deletedSources, processedBytes);
        this.publishProgress(batchId, 'copying', copied, files.length, processedBytes, true);
      }

      if (addedAssets === 0) {
        throw new AppError('WS-3004', { batchId });
      }

      this.deps.db.run("UPDATE ingest_batches SET state = 'organizing' WHERE id = ?", batchId);
      this.deps.events.transition(eventId, 'ingested', { actorId: null, reason: 'card ingest' });
      this.deps.events.writeManifest(this.deps.events.get(eventId));
      this.deps.db.run(
        `UPDATE ingest_batches
         SET state = 'completed', copied_files = ?, verified_files = ?, bytes = ?,
             deleted_sources = ?, finished_at = ?
         WHERE id = ?`,
        copied,
        verified,
        processedBytes,
        deletedSources,
        new Date().toISOString(),
        batchId,
      );
      try {
        rmSync(inboxDir, { recursive: true, force: true });
      } catch {
        // تنظيف تجميلي.
      }
      this.publishProgress(batchId, 'completed', copied, files.length, processedBytes, true);
      this.deps.logger.info('ingest.completed', {
        batchId,
        eventId,
        files: copied,
        verified,
        deletedSources,
        mode,
      });
    } catch (error) {
      const appError = AppError.from(error);
      this.deps.db.run(
        `UPDATE ingest_batches SET state = ?, error = ?, finished_at = ? WHERE id = ?`,
        this.cancelled.has(batchId) ? 'cancelled' : 'failed',
        appError.message,
        new Date().toISOString(),
        batchId,
      );
      this.publishProgress(batchId, 'failed', copied, files.length, processedBytes, true);
      this.deps.logger.error('ingest.failed', { batchId, code: appError.code, error: appError.message });
      if (addedAssets === 0) {
        try {
          this.deps.db.run('UPDATE ingest_batches SET event_id = NULL WHERE id = ?', batchId);
          this.deps.db.run('DELETE FROM events WHERE id = ?', eventId);
          rmSync(eventDir, { recursive: true, force: true });
        } catch {
          // تجاهل تنظيف حدث فارغ.
        }
      }
      throw appError;
    } finally {
      this.cancelled.delete(batchId);
    }
  }

  /**
   * يحذف مصدرًا واحدًا فقط بعد أن أصبح الأصل داخل المكتب ومتحققًا.
   * فشل الحذف لا يُفشل الدفعة؛ يُسجَّل ويُترك الملف ليقوم المستخدم بحذفه.
   */
  private deleteSource(
    batchId: string,
    preparedFile: PreparedFile,
    assetId: string,
    targetVolumeId: string,
    targetRel: string,
    sha256: string,
    bytes: number,
    currentDeleted: number,
  ): number {
    try {
      unlinkSync(longPath(preparedFile.file.absolutePath));
      const now = new Date().toISOString();
      this.deps.db.run('UPDATE ingest_files SET source_deleted_at = ? WHERE id = ?', now, preparedFile.rowId);
      this.deps.journal.record({
        assetId,
        sourcePath: preparedFile.file.absolutePath,
        targetVolumeId,
        targetRelPath: targetRel,
        sha256,
        bytes,
        mode: 'move',
        action: 'ingest',
      });
      const next = currentDeleted + 1;
      this.deps.db.run('UPDATE ingest_batches SET deleted_sources = ? WHERE id = ?', next, batchId);
      this.deps.bus.publish({
        type: 'log',
        level: 'info',
        message: `حُذف من المصدر بعد التحقق: ${preparedFile.file.relPath}`,
      });
      return next;
    } catch (error) {
      this.deps.db.run(
        'UPDATE ingest_files SET message = ? WHERE id = ?',
        'تعذّر حذف الملف من المصدر؛ بقي في مكانه.',
        preparedFile.rowId,
      );
      this.deps.logger.warn('ingest.source_delete_failed', {
        file: preparedFile.file.relPath,
        error: String(error),
      });
      return currentDeleted;
    }
  }

  private updateBatchCounters(
    batchId: string,
    copied: number,
    verified: number,
    deletedSources: number,
    bytes: number,
  ): void {
    this.deps.db.run(
      'UPDATE ingest_batches SET copied_files = ?, verified_files = ?, deleted_sources = ?, bytes = ? WHERE id = ?',
      copied,
      verified,
      deletedSources,
      bytes,
      batchId,
    );
  }

  private markFileFailed(rowId: number, message: string): void {
    this.deps.db.run("UPDATE ingest_files SET status = 'failed', message = ? WHERE id = ?", message, rowId);
  }

  private publishProgress(
    batchId: string,
    phase: string,
    copied: number,
    total: number,
    bytes: number,
    force = false,
  ): void {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < 300) return;
    this.lastProgressAt = now;
    this.deps.bus.publish({
      type: 'ingest.progress',
      batchId,
      phase,
      copied,
      total,
      bytes,
    });
  }
}

function mapBatch(row: BatchRow): IngestBatch {
  return {
    id: row.id,
    sourceLabel: row.source_label,
    state: row.state as IngestBatch['state'],
    eventId: row.event_id,
    totalFiles: row.total_files,
    copiedFiles: row.copied_files,
    verifiedFiles: row.verified_files,
    bytes: row.bytes,
    deletedSources: row.deleted_sources,
    mode: row.mode as IngestBatch['mode'],
    sourceRemovable: row.source_removable === 1,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function suggestEvent(
  input: IngestPreviewRequest,
  source: string,
): IngestPreview['suggested'] {
  const folder = basename(source);
  const lower = folder.toLowerCase();
  let kind: IngestPreview['suggested']['kind'] = input.kind ?? 'other';
  if (!input.kind) {
    if (/خطب|khutbah|jumu|friday/.test(lower)) kind = 'khutbah';
    else if (/درس|lesson|dars/.test(lower)) kind = 'lesson';
    else if (/عيد|فعالية|event|iftar|حفل/.test(lower)) kind = 'event';
    else if (/تصوير|photo|shoot/.test(lower)) kind = 'photoshoot';
  }

  const dateMatch = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(folder);
  let occurredAt = input.occurredAt;
  if (!occurredAt && dateMatch) {
    const [, year, month, day] = dateMatch;
    const candidate = `${year}-${month}-${day}`;
    if (!Number.isNaN(new Date(`${candidate}T12:00:00`).getTime())) occurredAt = candidate;
  }
  occurredAt ??= new Date().toISOString().slice(0, 10);

  const cleanFolder = folder.replace(/^(20\d{2})[-_.]?\d{2}[-_.]?\d{2}[_\-\s]*/, '');
  const title = input.title ?? (cleanFolder.length > 0 ? cleanFolder : folder);
  const slug = input.slug ?? ensureSlug(cleanFolder, kind === 'other' ? 'ingest' : kind);
  return { kind, title, slug, occurredAt };
}

function uniqueFileName(relPath: string, used: Set<string>): string {
  const original = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = original.lastIndexOf('.');
  const extension = dot >= 0 ? original.slice(dot).toLowerCase() : '';
  const base = dot >= 0 ? original.slice(0, dot) : original;
  let candidate = toSlug(base, 60);
  if (candidate.length === 0) {
    candidate = `file-${createHash('sha1').update(original).digest('hex').slice(0, 6)}`;
  }
  let name = `${candidate}${extension}`;
  let suffix = 2;
  while (used.has(name)) {
    name = `${candidate}-${suffix}${extension}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function uniqueDestination(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const extension = dot >= 0 ? name.slice(dot) : '';
  let suffix = 2;
  let candidate = `${base}-${suffix}${extension}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}${extension}`;
  }
  used.add(candidate);
  return candidate;
}

function moveFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(longPath(from), longPath(to));
  } catch {
    throw new AppError('WS-3002', { reason: 'move_failed', from, to });
  }
}
