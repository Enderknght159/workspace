import type { EventState, JobState } from './state-machines.js';

export type ServerEvent =
  | { type: 'hello'; seq: number; at: string; version: string }
  | { type: 'job.updated'; seq: number; at: string; jobId: string; eventId: string; state: JobState; step: string | null; progress: number }
  | { type: 'event.updated'; seq: number; at: string; eventId: string; state: EventState }
  | {
      type: 'ingest.progress';
      seq: number;
      at: string;
      batchId: string;
      phase: string;
      copied: number;
      total: number;
      bytes: number;
    }
  | { type: 'queue.stats'; seq: number; at: string; queued: number; running: number; failed: number }
  | { type: 'doctor.updated'; seq: number; at: string; ok: boolean }
  | { type: 'log'; seq: number; at: string; level: 'info' | 'warn' | 'error'; message: string; jobId?: string };

export type ServerEventType = ServerEvent['type'];

export type EventListener = (event: ServerEvent) => void;
