import { AppError } from './errors.js';

export const EVENT_STATES = [
  'draft',
  'ingested',
  'todo',
  'in_progress',
  'blocked',
  'edited',
  'in_review',
  'approved',
  'rejected',
  'published',
  'archived',
  'cold',
  'unknown',
] as const;

export type EventState = (typeof EVENT_STATES)[number];

export const EVENT_TRANSITIONS: Record<EventState, readonly EventState[]> = {
  draft: ['ingested', 'unknown'],
  ingested: ['todo', 'in_progress', 'unknown'],
  todo: ['in_progress', 'blocked', 'unknown'],
  in_progress: ['edited', 'blocked', 'in_review', 'unknown'],
  blocked: ['in_progress', 'todo', 'unknown'],
  edited: ['in_review', 'in_progress', 'unknown'],
  in_review: ['approved', 'rejected', 'in_progress', 'unknown'],
  approved: ['published', 'in_review', 'unknown'],
  rejected: ['in_progress', 'archived', 'unknown'],
  published: ['archived', 'unknown'],
  archived: ['cold', 'published', 'unknown'],
  cold: ['unknown'],
  unknown: ['ingested', 'in_progress', 'archived'],
};

export const JOB_STATES = [
  'queued',
  'running',
  'succeeded',
  'review_pending',
  'approved',
  'rejected',
  'published',
  'archived',
  'cancelled',
  'failed',
  'blocked',
  'blocked_offline',
  'interrupted',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const JOB_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'blocked', 'blocked_offline', 'cancelled'],
  blocked: ['queued', 'cancelled'],
  blocked_offline: ['queued', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'interrupted'],
  succeeded: ['review_pending', 'failed'],
  review_pending: ['approved', 'rejected', 'cancelled'],
  approved: ['published', 'archived'],
  rejected: ['archived'],
  published: ['archived'],
  archived: [],
  cancelled: [],
  failed: ['queued'],
  interrupted: ['queued', 'cancelled'],
};

export const OPEN_JOB_STATES: readonly JobState[] = [
  'queued',
  'running',
  'blocked',
  'blocked_offline',
  'interrupted',
  'review_pending',
];

export const TERMINAL_JOB_STATES: readonly JobState[] = [
  'archived',
  'cancelled',
  'published',
  'rejected',
];

export function canTransition<T extends string>(
  table: Record<T, readonly T[]>,
  from: T,
  to: T,
): boolean {
  return table[from]?.includes(to) ?? false;
}

export function assertEventTransition(from: EventState, to: EventState): void {
  if (!canTransition(EVENT_TRANSITIONS, from, to)) {
    throw new AppError('WS-4001', { from, to });
  }
}

export function assertJobTransition(from: JobState, to: JobState): void {
  if (!canTransition(JOB_TRANSITIONS, from, to)) {
    throw new AppError('WS-5002', { from, to });
  }
}
