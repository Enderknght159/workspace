import { z } from 'zod';
import {
  ASSET_KINDS,
  EVENT_KINDS,
  JOB_KINDS,
  JOB_MODES,
  REVIEW_DECISIONS,
  VOLUME_KINDS,
} from './constants.js';
import { EVENT_STATES, JOB_STATES } from './state-machines.js';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون YYYY-MM-DD');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T/, 'التاريخ يجب أن يكون ISO');
const slug = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'المعرّف بأحرف لاتينية صغيرة وأرقام وشرطات فقط');
const identifier = z.string().min(3).max(80);

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
});

export const officeSettingsSchema = z.object({
  office: z.object({
    name: z.string().min(1).max(120),
  }),
  ingest: z.object({
    warnBelowGb: z.number().min(1).max(10_000),
    blockBelowGb: z.number().min(1).max(10_000),
    copyEngine: z.enum(['auto', 'node', 'robocopy']),
    concurrentFiles: z.number().int().min(1).max(8),
    maxFileGb: z.number().min(1).max(512),
  }),
  queue: z.object({
    concurrency: z.number().int().min(1).max(4),
    nightWindow: z.object({
      enabled: z.boolean(),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    defaultMaxMinutes: z.number().int().min(1).max(1440),
    pollSeconds: z.number().min(0.5).max(60),
  }),
  archive: z.object({
    retentionDays: z.number().int().min(0).max(3650),
    trashDays: z.number().int().min(1).max(3650),
    autoRun: z.boolean(),
    trashAfterArchive: z.boolean(),
  }),
  agent: z.object({
    adapter: z.enum(['mock', 'opencode']),
    baseUrl: z.string().min(1),
    model: z.string().nullable(),
    timeoutMinutes: z.number().int().min(1).max(1440),
    mockDelayMs: z.number().int().min(0).max(60_000),
  }),
  ui: z.object({
    theme: z.enum(['dark', 'light']),
    reduceMotion: z.boolean(),
  }),
  security: z.object({
    elevationHash: z.string().nullable(),
    recoveryHash: z.string().nullable(),
    idleLockMinutes: z.number().int().min(1).max(240),
  }),
  publish: z.object({
    platforms: z.array(z.string().min(1)).min(1),
  }),
});

export type OfficeSettings = z.infer<typeof officeSettingsSchema>;

export const DEFAULT_SETTINGS: OfficeSettings = {
  office: { name: 'مكتب الوسائط' },
  ingest: {
    warnBelowGb: 60,
    blockBelowGb: 40,
    copyEngine: 'auto',
    concurrentFiles: 2,
    maxFileGb: 64,
  },
  queue: {
    concurrency: 1,
    nightWindow: { enabled: false, start: '23:00', end: '06:00' },
    defaultMaxMinutes: 120,
    pollSeconds: 2,
  },
  archive: {
    retentionDays: 7,
    trashDays: 30,
    autoRun: false,
    trashAfterArchive: true,
  },
  agent: {
    adapter: 'mock',
    baseUrl: 'http://127.0.0.1:4096',
    model: null,
    timeoutMinutes: 120,
    mockDelayMs: 600,
  },
  ui: { theme: 'dark', reduceMotion: false },
  security: { elevationHash: null, recoveryHash: null, idleLockMinutes: 10 },
  publish: { platforms: ['youtube', 'facebook', 'instagram', 'tiktok', 'whatsapp'] },
};

export const createEventRequest = z.object({
  kind: z.enum(EVENT_KINDS),
  title: z.string().min(2).max(200),
  occurredAt: dateOnly,
  slug: slug.optional(),
  ownerId: z.string().min(1).max(80).optional(),
});

export const updateEventRequest = z.object({
  title: z.string().min(2).max(200).optional(),
  kind: z.enum(EVENT_KINDS).optional(),
  occurredAt: dateOnly.optional(),
  ownerId: z.string().min(1).max(80).nullable().optional(),
});

export const transitionEventRequest = z.object({
  to: z.enum(EVENT_STATES),
  reason: z.string().max(1000).optional(),
});

export const createJobRequest = z.object({
  eventId: identifier,
  kind: z.enum(JOB_KINDS),
  mode: z.enum(JOB_MODES),
  styleId: z.string().min(1).max(80).nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  maxMinutes: z.number().int().min(1).max(1440).optional(),
});

export const reviewJobRequest = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    checklist: z.record(z.string(), z.boolean()),
    notes: z.string().max(4000).optional(),
    reviewerId: z.string().min(1).max(80).optional(),
  })
  .refine(
    (value) =>
      value.decision === 'approved' || (value.notes !== undefined && value.notes.trim().length >= 3),
    { message: 'سبب الإعادة أو الرفض مطلوب', path: ['notes'] },
  );

export const publishJobRequest = z.object({
  platform: z.string().min(1).max(40),
  url: z.string().url(),
  publishedBy: z.string().min(1).max(80).optional(),
});

export const registerVolumeRequest = z.object({
  root: z.string().min(3).max(1000),
  label: z.string().min(1).max(120),
  kind: z.enum(VOLUME_KINDS),
});

export const ingestPreviewRequest = z.object({
  source: z.string().min(3).max(1000),
  kind: z.enum(EVENT_KINDS).optional(),
  title: z.string().min(2).max(200).optional(),
  slug: slug.optional(),
  occurredAt: dateOnly.optional(),
});

export const archiveRunRequest = z.object({
  targetVolumeId: identifier,
  dryRun: z.boolean(),
  eventIds: z.array(identifier).optional(),
});

export const settingsPatchRequest = z.object({
  office: officeSettingsSchema.shape.office.partial().optional(),
  ingest: officeSettingsSchema.shape.ingest.partial().optional(),
  queue: officeSettingsSchema.shape.queue.partial().optional(),
  archive: officeSettingsSchema.shape.archive.partial().optional(),
  agent: officeSettingsSchema.shape.agent.partial().optional(),
  ui: officeSettingsSchema.shape.ui.partial().optional(),
  security: z
    .object({
      idleLockMinutes: z.number().int().min(1).max(240).optional(),
    })
    .optional(),
  publish: officeSettingsSchema.shape.publish.partial().optional(),
});

export const elevateRequest = z.object({
  password: z.string().min(1).max(500),
});

export const setElevationPasswordRequest = z.object({
  password: z.string().min(6).max(500),
});

export const listQuery = z.object({
  state: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const eventIdParams = z.object({ id: identifier });
export const jobIdParams = z.object({ id: identifier });

export const jobFilterQuery = z.object({
  state: z.enum(JOB_STATES).optional(),
  eventId: identifier.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const styleParamSchema = z.object({
  id: z.string().min(1).max(80),
});

export const assetKindSchema = z.enum(ASSET_KINDS);
export const isoDateSchema = isoDate;

export const actorHeader = z.string().min(1).max(80).optional();

export type CreateEventRequest = z.infer<typeof createEventRequest>;
export type UpdateEventRequest = z.infer<typeof updateEventRequest>;
export type TransitionEventRequest = z.infer<typeof transitionEventRequest>;
export type CreateJobRequest = z.infer<typeof createJobRequest>;
export type ReviewJobRequest = z.infer<typeof reviewJobRequest>;
export type PublishJobRequest = z.infer<typeof publishJobRequest>;
export type RegisterVolumeRequest = z.infer<typeof registerVolumeRequest>;
export type IngestPreviewRequest = z.infer<typeof ingestPreviewRequest>;
export type ArchiveRunRequest = z.infer<typeof archiveRunRequest>;
export type SettingsPatchRequest = z.infer<typeof settingsPatchRequest>;
export type ListQuery = z.infer<typeof listQuery>;
