import { copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Database } from '../db/database.js';
import { openDriver } from '../db/driver.js';
import { migrate } from '../db/migrations.js';
import { AppError } from '../../shared/errors.js';
import { createLogger, type Logger } from '../util/logger.js';
import { EventBus } from '../util/event-bus.js';
import { machineId } from '../util/misc.js';
import { loadOrCreateOfficeConfig, writeJsonAtomic, type OfficeConfig } from './config.js';
import { OfficeLock, lockFileFor } from './lock.js';
import { OfficePaths } from './paths.js';
import { AuditService } from '../services/audit-service.js';
import { SettingsService } from '../services/settings-service.js';
import { MachineProfileStore } from '../services/machine-profile.js';
import { VolumeService } from '../services/volume-service.js';
import { EventService } from '../services/event-service.js';
import { DoctorService, type CommandRunner } from '../services/doctor-service.js';
import { IngestService } from '../services/ingest-service.js';
import { StyleService } from '../services/style-service.js';
import { JobService } from '../services/job-service.js';
import { JobQueue } from '../services/job-queue.js';
import { SecurityService } from '../services/security-service.js';
import { ArchiveService } from '../services/archive-service.js';
import { MoveJournalService } from '../services/move-journal-service.js';
import { AssetService } from '../services/asset-service.js';
import { UserService } from '../services/user-service.js';
import { EditTaskService } from '../services/edit-task-service.js';
import { APP_SCHEMA } from '../../shared/constants.js';

export interface OpenOfficeOptions {
  dir: string;
  name?: string;
  logger?: Logger;
  clock?: () => Date;
  volumeProbe?: (root: string) => import('../services/volume-identity.js').PhysicalIdentity;
  volumeMountLister?: () => import('../services/volume-identity.js').MountedDrive[];
  commandRunner?: import('../services/doctor-service.js').CommandRunner;
}

/**
 * المكتب: المورد الوحيد لقاعدة البيانات والخدمات.
 * فتح مكتبين لنفس المجلد في نفس العملية مرفوض بقفل الملف.
 */
export class Office {
  readonly paths: OfficePaths;
  readonly config: OfficeConfig;
  readonly db: Database;
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly audit: AuditService;
  readonly settings: SettingsService;
  readonly profile: MachineProfileStore;
  readonly volumes: VolumeService;
  readonly events: EventService;
  readonly ingest: IngestService;
  readonly styles: StyleService;
  readonly jobs: JobService;
  readonly queue: JobQueue;
  readonly doctor: DoctorService;
  readonly security: SecurityService;
  readonly archive: ArchiveService;
  readonly assets: AssetService;
  readonly users: UserService;
  readonly moves: MoveJournalService;
  readonly editTasks: EditTaskService;
  readonly machineId: string;
  private readonly lock: OfficeLock;
  private closed = false;

  private constructor(options: {
    paths: OfficePaths;
    config: OfficeConfig;
    db: Database;
    logger: Logger;
    lock: OfficeLock;
    clock?: () => Date;
    probe?: (root: string) => import('../services/volume-identity.js').PhysicalIdentity;
    listMounts?: () => import('../services/volume-identity.js').MountedDrive[];
    commandRunner?: CommandRunner;
  }) {
    this.paths = options.paths;
    this.config = options.config;
    this.db = options.db;
    this.logger = options.logger;
    this.lock = options.lock;
    this.machineId = machineId();
    this.bus = new EventBus();
    this.audit = new AuditService(this.db, this.machineId);
    this.settings = new SettingsService(this.db, this.audit, this.logger);
    this.profile = new MachineProfileStore(this.paths);
    this.volumes = new VolumeService({
      db: this.db,
      profile: this.profile,
      audit: this.audit,
      logger: this.logger,
      probe: options.probe,
      listMounts: options.listMounts,
    });
    this.events = new EventService({
      db: this.db,
      paths: this.paths,
      volumes: this.volumes,
      audit: this.audit,
      bus: this.bus,
      logger: this.logger,
      clock: options.clock,
    });
    this.moves = new MoveJournalService({
      db: this.db,
      paths: this.paths,
      volumes: this.volumes,
      audit: this.audit,
      logger: this.logger,
    });
    this.ingest = new IngestService({
      db: this.db,
      paths: this.paths,
      volumes: this.volumes,
      events: this.events,
      settings: this.settings,
      audit: this.audit,
      journal: this.moves,
      bus: this.bus,
      logger: this.logger,
    });
    this.ingest.recoverInterrupted();
    this.styles = new StyleService(this.db, this.paths, this.logger);
    this.styles.ensureSample();
    this.styles.reload();
    this.jobs = new JobService({
      db: this.db,
      paths: this.paths,
      events: this.events,
      volumes: this.volumes,
      styles: this.styles,
      settings: this.settings,
      audit: this.audit,
      bus: this.bus,
      logger: this.logger,
      clock: options.clock,
      machineId: this.machineId,
    });
    this.queue = new JobQueue({
      jobs: this.jobs,
      events: this.events,
      volumes: this.volumes,
      settings: this.settings,
      logger: this.logger,
      paths: this.paths,
    });
    this.jobs.attachQueue(this.queue);
    this.security = new SecurityService(this.settings, this.audit, this.logger);
    this.archive = new ArchiveService({
      db: this.db,
      paths: this.paths,
      volumes: this.volumes,
      events: this.events,
      settings: this.settings,
      audit: this.audit,
      logger: this.logger,
    });
    this.assets = new AssetService({
      db: this.db,
      paths: this.paths,
      volumes: this.volumes,
      events: this.events,
      journal: this.moves,
      audit: this.audit,
      logger: this.logger,
    });
    this.users = new UserService(this.db, this.audit);
    this.editTasks = new EditTaskService({
      db: this.db,
      paths: this.paths,
      events: this.events,
      volumes: this.volumes,
      audit: this.audit,
      logger: this.logger,
    });
    this.doctor = new DoctorService({
      profile: this.profile,
      bus: this.bus,
      logger: this.logger,
      runner: options.commandRunner,
    });
  }

  static open(options: OpenOfficeOptions): Office {
    const paths = new OfficePaths(options.dir);
    paths.ensureDirs();
    const lock = new OfficeLock(lockFileFor(paths.locksDir));
    lock.acquire();

    const logger =
      options.logger ??
      createLogger({
        file: `${paths.logsDir}/engine.jsonl`,
        level: process.env.WORKSPACE_LOG_LEVEL === 'debug' ? 'debug' : 'info',
        console: process.env.WORKSPACE_LOG_CONSOLE === '1',
      });

    try {
      const { config } = loadOrCreateOfficeConfig(paths, options.name ?? 'مكتب الوسائط');
      const db = new Database(openDriver(paths.dbFile), paths.dbFile);
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      db.exec('PRAGMA foreign_keys = ON');
      db.exec('PRAGMA busy_timeout = 5000');
      migrate(db);

      const existing = db.get<{ id: string; name: string }>('SELECT id, name FROM office LIMIT 1');
      if (existing && existing.id !== config.id) {
        throw new AppError('WS-1001', {
          reason: 'office_id_mismatch',
          configId: config.id,
          databaseId: existing.id,
        });
      }
      db.run(
        `INSERT INTO office (id, name, schema, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, schema = excluded.schema`,
        config.id,
        config.name,
        APP_SCHEMA,
        config.createdAt,
      );

      logger.info('office.opened', { officeId: config.id, dir: paths.root });
      return new Office({
        paths,
        config,
        db,
        logger,
        lock,
        clock: options.clock,
        probe: options.volumeProbe,
        listMounts: options.volumeMountLister,
        commandRunner: options.commandRunner,
      });
    } catch (error) {
      lock.release();
      if (String(error).includes('SQLITE_BUSY')) {
        throw new AppError('WS-1002', { reason: 'sqlite_busy' }, error);
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.queue.stop();
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // لا نُفشل الإغلاق.
    }
    this.db.close();
    this.lock.release();
    this.logger.info('office.closed', { officeId: this.config.id });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new AppError('WS-0003', { field: 'name' });
    this.config.name = trimmed;
    writeJsonAtomic(this.paths.officeFile, this.config);
    this.db.run('UPDATE office SET name = ? WHERE id = ?', trimmed, this.config.id);
    this.logger.info('office.renamed', { officeId: this.config.id });
  }

  backup(): { name: string; bytes: number; createdAt: string } {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `workspace-${stamp}.db`;
    const target = join(this.paths.backupsDir, name);
    copyFileSync(this.paths.dbFile, target);
    this.pruneBackups(14);
    const size = statSync(target).size;
    this.audit.record({
      actorId: null,
      action: 'office.backup',
      entity: 'office',
      entityId: this.config.id,
      after: { name, bytes: size },
      elevated: true,
    });
    return { name, bytes: size, createdAt: new Date().toISOString() };
  }

  listBackups(): Array<{ name: string; bytes: number; createdAt: string }> {
    return readdirSync(this.paths.backupsDir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => {
        const stats = statSync(join(this.paths.backupsDir, name));
        return { name, bytes: stats.size, createdAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private pruneBackups(keep: number): void {
    const backups = this.listBackups();
    for (const backup of backups.slice(keep)) {
      try {
        unlinkSync(join(this.paths.backupsDir, basename(backup.name)));
      } catch {
        // تجاهل.
      }
    }
  }
}
