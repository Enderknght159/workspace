import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { Volume, VolumeView } from '../../shared/models.js';
import type { RegisterVolumeRequest } from '../../shared/schemas.js';
import type { Database } from '../db/database.js';
import type { AuditService } from './audit-service.js';
import { freeBytesAt, MachineProfileStore } from './machine-profile.js';
import {
  assertVolumeRoot,
  listMountedDrives,
  probePhysicalIdentity,
  readFingerprint,
  writeFingerprint,
  type MountedDrive,
  type PhysicalIdentity,
} from './volume-identity.js';
import type { Logger } from '../util/logger.js';

export interface VolumeServiceDeps {
  db: Database;
  profile: MachineProfileStore;
  audit: AuditService;
  logger: Logger;
  probe?: (root: string) => PhysicalIdentity;
  listMounts?: () => MountedDrive[];
}

interface VolumeRow {
  id: string;
  label: string;
  kind: string;
  status: string;
  volume_guid: string | null;
  serial: string | null;
  fs_type: string | null;
  size_bytes: number | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export class VolumeService {
  constructor(private readonly deps: VolumeServiceDeps) {}

  private probe(root: string): PhysicalIdentity {
    return this.deps.probe ? this.deps.probe(root) : probePhysicalIdentity(root);
  }

  list(): VolumeView[] {
    const rows = this.deps.db.all<VolumeRow>('SELECT * FROM volumes ORDER BY kind ASC, label ASC');
    return rows.map((row) => this.mapRow(row));
  }

  get(id: string): VolumeView | null {
    const row = this.deps.db.get<VolumeRow>('SELECT * FROM volumes WHERE id = ?', id);
    return row ? this.mapRow(row) : null;
  }

  /** يستخدمه EventService: أول قرص ساخن متصل. */
  defaultHot(): VolumeView | null {
    const volumes = this.list();
    return (
      volumes.find((volume) => volume.kind === 'hot' && volume.status === 'connected' && volume.root) ??
      volumes.find((volume) => volume.kind === 'hot') ??
      null
    );
  }

  register(input: RegisterVolumeRequest, actorId: string | null, officeId: string): VolumeView {
    const root = resolve(input.root);
    if (!existsSync(root)) throw new AppError('WS-2001', { root });
    mkdirSync(root, { recursive: true });
    assertVolumeRoot(root);

    const physical = this.probe(root);
    const fingerprint = readFingerprint(root);
    const id = fingerprint?.volume_id ?? newId('vol');

    if (physical.volumeGuid) {
      const clash = this.deps.db.get<VolumeRow>(
        'SELECT * FROM volumes WHERE volume_guid = ? AND id <> ?',
        physical.volumeGuid,
        id,
      );
      if (clash) {
        this.deps.logger.warn('volume.clone_detected', { root, existing: clash.id, candidate: id });
        throw new AppError('WS-2004', { existingVolumeId: clash.id, root });
      }
    }

    const now = new Date().toISOString();
    const existing = this.deps.db.get<VolumeRow>('SELECT * FROM volumes WHERE id = ?', id);
    if (
      existing &&
      physical.volumeGuid &&
      existing.volume_guid &&
      physical.volumeGuid !== existing.volume_guid
    ) {
      throw new AppError('WS-2004', {
        reason: 'fingerprint_id_on_other_disk',
        existingVolumeId: existing.id,
        root,
      });
    }
    if (existing) {
      this.deps.db.run(
        `UPDATE volumes SET label = ?, kind = ?, status = 'connected', volume_guid = COALESCE(?, volume_guid),
          serial = COALESCE(?, serial), fs_type = COALESCE(?, fs_type), size_bytes = COALESCE(?, size_bytes),
          last_seen_at = ?, updated_at = ? WHERE id = ?`,
        input.label,
        input.kind,
        physical.volumeGuid,
        physical.serial,
        physical.fsType,
        physical.sizeBytes,
        now,
        now,
        id,
      );
    } else {
      this.deps.db.run(
        `INSERT INTO volumes
          (id, label, kind, status, volume_guid, serial, fs_type, size_bytes, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.label,
        input.kind,
        physical.volumeGuid,
        physical.serial,
        physical.fsType,
        physical.sizeBytes,
        now,
        now,
        now,
      );
    }

    writeFingerprint(root, { id, label: input.label, kind: input.kind, officeId });
    this.deps.profile.setMount(id, root);
    this.deps.audit.record({
      actorId,
      action: existing ? 'volume.refresh' : 'volume.register',
      entity: 'volume',
      entityId: id,
      after: { label: input.label, kind: input.kind, root, physical },
    });
    this.deps.logger.info('volume.registered', { volumeId: id, kind: input.kind });
    return this.get(id) as VolumeView;
  }

  /**
   * يعيد مطابقة الأقراص المعروفة. لا يخمّن الحرف ولا يبحث في كل الأقراص بعد.
   * التوسعة القادمة: تعداد كل الأقراص عبر PowerShell لاكتشاف تغيّر الحرف.
   */
  scan(): VolumeView[] {
    const rows = this.deps.db.all<VolumeRow>('SELECT * FROM volumes');
    const now = new Date().toISOString();
    this.refreshMounts(rows);
    for (const row of rows) {
      const root = this.deps.profile.mountOf(row.id);
      let status: Volume['status'] = 'offline';
      if (root && existsSync(root)) {
        const fingerprint = readFingerprint(root);
        if (!fingerprint) status = 'fingerprint_missing';
        else if (fingerprint.volume_id !== row.id) status = 'foreign';
        else {
          const physical = this.probe(root);
          if (
            row.volume_guid &&
            physical.volumeGuid &&
            row.volume_guid !== physical.volumeGuid
          ) {
            status = 'cloned';
          } else {
            status = 'connected';
            this.deps.db.run(
              `UPDATE volumes SET size_bytes = COALESCE(?, size_bytes), last_seen_at = ?, updated_at = ? WHERE id = ?`,
              physical.sizeBytes,
              now,
              now,
              row.id,
            );
          }
        }
      }
      this.deps.db.run('UPDATE volumes SET status = ?, updated_at = ? WHERE id = ?', status, now, row.id);
    }
    return this.list();
  }

  /**
   * يطابق بصمات الأقراص على كل الأحرف الحالية، فينجو المكتب من تغيّر حرف القرص.
   * لا يسجّل قرصًا جديدًا تلقائيًا: القرص الغريب لا يُلمس.
   */
  private refreshMounts(rows: VolumeRow[]): void {
    const byId = new Map(rows.map((row) => [row.id, row]));
    let mounts: MountedDrive[] = [];
    try {
      mounts = (this.deps.listMounts ?? listMountedDrives)();
    } catch {
      return;
    }
    for (const mount of mounts) {
      const fingerprint = readFingerprint(mount.root);
      if (!fingerprint) continue;
      const row = byId.get(fingerprint.volume_id);
      if (!row) continue;
      const current = this.deps.profile.mountOf(row.id);
      const matchesGuid =
        !row.volume_guid || !mount.volumeGuid || row.volume_guid === mount.volumeGuid;
      if (matchesGuid && (!current || !existsSync(current))) {
        this.deps.profile.setMount(row.id, mount.root);
        this.deps.logger.info('volume.remounted', { volumeId: row.id, root: mount.root });
      }
    }
  }

  private mapRow(row: VolumeRow): VolumeView {    const root = this.deps.profile.mountOf(row.id);
    return {
      id: row.id,
      label: row.label,
      kind: row.kind as Volume['kind'],
      status: row.status as Volume['status'],
      volumeGuid: row.volume_guid,
      serial: row.serial,
      fsType: row.fs_type,
      sizeBytes: row.size_bytes,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      root,
      freeBytes: root && existsSync(root) ? freeBytesAt(root) : null,
    };
  }
}
