import type { EventState, JobState } from '../../shared/state-machines.js';
import type { EventKind, JobKind } from '../../shared/constants.js';

const EVENT_LABELS: Record<EventState, string> = {
  draft: 'مسودة',
  ingested: 'وارد',
  todo: 'للعمل',
  in_progress: 'قيد التنفيذ',
  blocked: 'متوقف',
  edited: 'معدّل',
  in_review: 'للمراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  published: 'منشور',
  archived: 'مؤرشف',
  cold: 'في الهارد البارد',
  unknown: 'غير معروف',
};

const JOB_LABELS: Record<JobState, string> = {
  queued: 'في الطابور',
  running: 'قيد التنفيذ',
  succeeded: 'نجحت',
  review_pending: 'بانتظار المراجعة',
  approved: 'معتمدة',
  rejected: 'أُعيدت',
  published: 'منشورة',
  archived: 'مؤرشفة',
  cancelled: 'ملغاة',
  failed: 'فاشلة',
  blocked: 'متوقفة',
  blocked_offline: 'القرص غير موصول',
  interrupted: 'انقطعت',
};

const KIND_LABELS: Record<EventKind, string> = {
  lesson: 'درس',
  khutbah: 'خطبة',
  event: 'فعالية',
  photoshoot: 'جلسة تصوير',
  other: 'أخرى',
};

const JOB_KIND_LABELS: Record<JobKind, string> = {
  ingest: 'تفريغ بطاقة',
  transcribe: 'تفريغ نصي',
  edit: 'مونتاج',
  thumbnail: 'غلاف',
  reel: 'ريل',
  export: 'تصدير',
  publish: 'نشر',
  archive: 'أرشفة',
};

export function eventStateLabel(state: EventState | string): string {
  return EVENT_LABELS[state as EventState] ?? state;
}

export function jobStateLabel(state: JobState | string): string {
  return JOB_LABELS[state as JobState] ?? state;
}

export function eventKindLabel(kind: EventKind | string): string {
  return KIND_LABELS[kind as EventKind] ?? kind;
}

export function jobKindLabel(kind: JobKind | string): string {
  return JOB_KIND_LABELS[kind as JobKind] ?? kind;
}

export type Tone = 'green' | 'gold' | 'red' | 'blue' | 'neutral' | 'violet';

export function eventTone(state: EventState | string): Tone {
  switch (state) {
    case 'approved':
    case 'published':
    case 'cold':
      return 'green';
    case 'in_review':
    case 'edited':
      return 'gold';
    case 'rejected':
    case 'blocked':
      return 'red';
    case 'in_progress':
      return 'blue';
    default:
      return 'neutral';
  }
}

export function jobTone(state: JobState | string): Tone {
  switch (state) {
    case 'approved':
    case 'published':
    case 'archived':
      return 'green';
    case 'review_pending':
    case 'succeeded':
      return 'gold';
    case 'failed':
    case 'cancelled':
    case 'blocked':
    case 'blocked_offline':
      return 'red';
    case 'running':
      return 'blue';
    case 'rejected':
      return 'violet';
    default:
      return 'neutral';
  }
}

export function toolTone(status: string): Tone {
  if (status === 'ok') return 'green';
  if (status === 'warn') return 'gold';
  if (status === 'fail') return 'red';
  return 'neutral';
}
