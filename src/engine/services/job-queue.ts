import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import type { AgentAdapter } from '../agent/types.js';
import { MockAgentAdapter } from '../agent/mock-agent.js';
import { OpenCodeAdapter } from '../agent/opencode-agent.js';
import type { EventService } from './event-service.js';
import type { JobService } from './job-service.js';
import type { SettingsService } from './settings-service.js';
import type { VolumeService } from './volume-service.js';
import type { Logger } from '../util/logger.js';
import type { OfficePaths } from '../office/paths.js';
import { isProcessAlive } from '../office/lock.js';

export interface JobQueueDeps {
  jobs: JobService;
  events: EventService;
  volumes: VolumeService;
  settings: SettingsService;
  logger: Logger;
  paths: OfficePaths;
}

interface RunningJob {
  id: string;
  controller: AbortController;
}

/**
 * عامل واحد. يفصل بين الجدولة والتنفيذ، ويستطيع إيقاف نفسه دون فقدان الطابور.
 */
export class JobQueue {
  private timer: NodeJS.Timeout | null = null;
  private current: RunningJob | null = null;
  private stopped = true;
  private readonly cancelled = new Set<string>();
  private ticking = false;

  constructor(private readonly deps: JobQueueDeps) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const requeued = this.deps.jobs.requeueInterrupted();
    if (requeued > 0) {
      this.deps.logger.info('queue.resumed', { jobs: requeued });
    }
    this.schedule(150);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.current) {
      this.current.controller.abort();
      this.current = null;
    }
    await Promise.resolve();
  }

  kick(): void {
    if (this.stopped) return;
    this.schedule(80);
  }

  cancel(jobId: string): void {
    this.cancelled.add(jobId);
    if (this.current?.id === jobId) {
      this.current.controller.abort();
    }
  }

  get isRunning(): boolean {
    return this.current !== null;
  }

  private schedule(delayMs?: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = delayMs ?? this.deps.settings.get().queue.pollSeconds * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.ticking || this.current) {
      if (!this.stopped) this.schedule();
      return;
    }
    this.ticking = true;
    try {
      this.deps.jobs.requeueOffline();
      const claimed = this.claimNext();
      if (!claimed) {
        this.schedule();
        return;
      }
      await this.execute(claimed.job.id, claimed.releaseLock);
    } catch (error) {
      this.deps.logger.error('queue.tick_failed', { error: String(error) });
    } finally {
      this.ticking = false;
      if (!this.stopped && !this.current) this.schedule();
    }
  }

  private claimNext(): { job: ReturnType<JobService['get']>; releaseLock: () => void } | null {
    const queued = this.deps.jobs.list({ state: 'queued', limit: 25 });
    if (queued.length === 0) return null;
    const settings = this.deps.settings.get();
    const canRunAuto = this.autoWindowOpen();

    for (const candidate of queued) {
      if (candidate.mode === 'auto' && !canRunAuto) continue;
      const event = this.deps.events.get(candidate.eventId);
      const volume = event.volumeId ? this.deps.volumes.get(event.volumeId) : null;
      if (!volume?.root || volume.status !== 'connected') {
        this.deps.jobs.blockJob(candidate.id, new AppError('WS-2002', { volumeId: event.volumeId }), true);
        continue;
      }
      const releaseLock = acquireGpuLock(join(this.deps.paths.locksDir, 'gpu.lock'));
      if (!releaseLock) {
        this.deps.logger.warn('queue.gpu_locked');
        return null;
      }
      const started = this.deps.jobs.startJob(candidate.id);
      if (!started) {
        releaseLock();
        continue;
      }
      return { job: started, releaseLock };
    }
    return null;
  }

  private async execute(jobId: string, releaseLock: () => void): Promise<void> {
    const job = this.deps.jobs.get(jobId);
    const controller = new AbortController();
    this.current = { id: jobId, controller };
    const timeoutMs = Math.max(1, job.maxMinutes) * 60_000;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const built = this.deps.jobs.buildJobFile(jobId);
      const adapter = this.createAdapter();
      if (!(await adapter.isAvailable())) {
        throw new AppError('WS-5010', { adapter: adapter.id });
      }
      this.deps.jobs.appendLog(jobId, 'info', `الوكيل: ${adapter.id}`);
      const result = await adapter.run({
        jobId,
        jobFile: built.jobFile,
        paths: {
          volumeRoot: built.volumeRoot,
          eventDir: built.eventDir,
          workDir: built.workDir,
          outputDir: built.outputDir,
          jobFileRel: built.jobFileRel,
          workRel: built.workRel,
          outputRel: built.outputRel,
        },
        signal: controller.signal,
        onProgress: (progress, step) => this.deps.jobs.updateProgress(jobId, progress, step),
        onLog: (level, message, data) => this.deps.jobs.appendLog(jobId, level, message, data),
      });

      for (const required of built.jobFile.output.required) {
        const file = this.deps.paths.resolveInside(built.outputDir, required);
        if (!existsSync(file)) {
          throw new AppError('WS-5007', { reason: 'missing_output', required });
        }
      }
      for (const output of result.result.outputs) {
        this.deps.paths.resolveInside(built.outputDir, output.path);
      }
      this.deps.jobs.finishSuccess(jobId, result.result, result.sessionId);
    } catch (error) {
      if (this.cancelled.has(jobId)) {
        this.deps.jobs.finishCancelled(jobId);
      } else if (timedOut) {
        this.deps.jobs.finishFailure(jobId, new AppError('WS-5005', { minutes: job.maxMinutes }), false);
      } else {
        const appError = AppError.from(error);
        if (appError.code === 'WS-5010') {
          this.deps.jobs.blockJob(jobId, appError);
        } else {
          this.deps.jobs.finishFailure(jobId, appError, true);
        }
      }
    } finally {
      clearTimeout(timeout);
      this.cancelled.delete(jobId);
      this.current = null;
      releaseLock();
    }
  }

  private createAdapter(): AgentAdapter {
    const agent = this.deps.settings.get().agent;
    if (agent.adapter === 'opencode') {
      return new OpenCodeAdapter({
        baseUrl: agent.baseUrl,
        model: agent.model,
        logger: this.deps.logger,
      });
    }
    return new MockAgentAdapter(agent.mockDelayMs);
  }

  private autoWindowOpen(): boolean {
    const window = this.deps.settings.get().queue.nightWindow;
    if (!window.enabled) return true;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = parseTime(window.start);
    const end = parseTime(window.end);
    if (start === null || end === null) return true;
    if (start <= end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }
}

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function acquireGpuLock(file: string): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          const owner = Number(readFileSync(file, 'utf8').trim());
          if (owner === process.pid) unlinkSync(file);
        } catch {
          // تجاهل.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null;
      try {
        const owner = Number(readFileSync(file, 'utf8').trim());
        if (Number.isFinite(owner) && isProcessAlive(owner)) return null;
        unlinkSync(file);
      } catch {
        return null;
      }
    }
  }
  return null;
}
