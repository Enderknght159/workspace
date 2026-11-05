import type {
  AssetKind,
  EventKind,
  JobKind,
  JobMode,
  ReviewDecision,
  VolumeKind,
  VolumeStatus,
} from './constants.js';
import type { EventState, JobState } from './state-machines.js';

export interface OfficeInfo {
  id: string;
  name: string;
  schema: number;
  createdAt: string;
  engineVersion: string;
}

export interface Volume {
  id: string;
  label: string;
  kind: VolumeKind;
  status: VolumeStatus;
  volumeGuid: string | null;
  serial: string | null;
  fsType: string | null;
  sizeBytes: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VolumeView extends Volume {
  root: string | null;
  freeBytes: number | null;
}

export interface EventSummary {
  id: string;
  kind: EventKind;
  title: string;
  slug: string;
  occurredAt: string;
  state: EventState;
  ownerId: string | null;
  volumeId: string | null;
  relPath: string | null;
  assetCount: number;
  jobCount: number;
  openJobCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  eventId: string;
  sha256: string;
  volumeId: string;
  relPath: string;
  kind: AssetKind;
  bytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  status: 'present' | 'missing' | 'archived' | 'trashed';
  duplicateOf: string | null;
  createdAt: string;
}

export interface JobSummary {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: JobKind;
  mode: JobMode;
  styleId: string | null;
  styleName: string | null;
  styleVersion: string | null;
  state: JobState;
  priority: number;
  progress: number;
  step: string | null;
  attempts: number;
  maxAttempts: number;
  maxMinutes: number;
  errorCode: string | null;
  errorMessage: string | null;
  resultJson: string | null;
  workspaceRel: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface JobLogEntry {
  id: number;
  jobId: string;
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: unknown;
}

export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
}

export interface Review {
  id: string;
  jobId: string;
  reviewerId: string | null;
  decision: ReviewDecision;
  checklist: Record<string, boolean>;
  notes: string | null;
  createdAt: string;
}

export interface Publication {
  id: string;
  jobId: string;
  platform: string;
  url: string;
  publishedAt: string;
  publishedBy: string | null;
}

export interface JobDetail extends JobSummary {
  checklist: ChecklistItem[];
  logs: JobLogEntry[];
  review: Review | null;
  publication: Publication | null;
  outputs: JobOutput[];
}

export interface JobOutput {
  path: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface EventDetail extends EventSummary {
  assets: Asset[];
  jobs: JobSummary[];
  reviews: Review[];
  publications: Publication[];
  manifest: Record<string, unknown> | null;
}

export interface StyleInfo {
  id: string;
  name: string;
  skillId: string;
  version: string;
  hash: string;
  description: string;
  estMinutes: number;
  gpu: boolean;
  enabled: boolean;
  checklist: ChecklistItem[];
  outputs: string[];
  previewPath: string | null;
  requirements: string[];
}

export interface IngestBatch {
  id: string;
  sourceLabel: string;
  state: 'previewing' | 'copying' | 'verifying' | 'organizing' | 'completed' | 'failed' | 'cancelled';
  eventId: string | null;
  totalFiles: number;
  copiedFiles: number;
  verifiedFiles: number;
  bytes: number;
  deletedSources: number;
  mode: 'copy' | 'move';
  sourceRemovable: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface IngestFile {
  relPath: string;
  bytes: number;
  sha256: string | null;
  status: 'pending' | 'copied' | 'verified' | 'duplicate' | 'failed';
  assetId: string | null;
}

export interface IngestPreview {
  source: string;
  files: Array<{ relPath: string; bytes: number; kind: AssetKind; selected: boolean }>;
  totalFiles: number;
  totalBytes: number;
  selectedFiles: number;
  selectedBytes: number;
  duplicates: Array<{ relPath: string; assetId: string }>;
  suggested: {
    kind: EventKind;
    title: string;
    slug: string;
    occurredAt: string;
  };
  freeBytes: number | null;
  warnings: string[];
  blocked: boolean;
  blockReason: string | null;
  sourceRemovable: boolean;
  recommendedMode: 'copy' | 'move';
}

export type ToolStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface ToolCheck {
  id: string;
  label: string;
  status: ToolStatus;
  version: string | null;
  detail: string | null;
  action: string | null;
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: string;
  machineId: string;
  platform: string;
  arch: string;
  cpus: number;
  totalMemoryGb: number;
  tools: ToolCheck[];
}

export interface MachineProfile extends DoctorReport {
  appVersion: string;
  nodeVersion: string;
  electronVersion: string | null;
  volumeMounts: Record<string, string>;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  at: string;
  elevated: boolean;
  machineId: string | null;
}

export interface QueueStats {
  queued: number;
  running: number;
  failed: number;
  review: number;
}

export interface ArchiveCandidate {
  eventId: string;
  title: string;
  publishedAt: string | null;
  assetCount: number;
  bytes: number;
  openJobs: number;
}

export interface ArchiveItemResult {
  eventId: string;
  title: string;
  status: 'copied' | 'skipped' | 'failed';
  assets: number;
  bytes: number;
  error: string | null;
}

export interface ArchiveReport {
  dryRun: boolean;
  targetVolumeId: string;
  items: ArchiveItemResult[];
  copied: number;
  failed: number;
  bytes: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface User {
  id: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface MoveJournalEntry {
  id: string;
  assetId: string | null;
  sourcePath: string;
  targetVolumeId: string;
  targetRelPath: string;
  sha256: string;
  bytes: number;
  mode: 'copy' | 'move';
  action: 'ingest' | 'relocate' | 'undo';
  state: 'completed' | 'undone';
  createdAt: string;
  undoneAt: string | null;
}

export type EditTaskState =
  | 'planned'
  | 'project_ready'
  | 'editing'
  | 'exported'
  | 'review'
  | 'approved'
  | 'archived'
  | 'cancelled';

export type EditTaskKind = 'full' | 'reel' | 'khutbah';

export interface EditTask {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: EditTaskKind;
  title: string;
  state: EditTaskState;
  projectRel: string | null;
  outputRel: string | null;
  subtitleRel: string | null;
  sequenceName: string | null;
  exportedFileRel: string | null;
  externalOutputPath: string | null;
  exportedBytes: number | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EditTaskDetail extends EditTask {
  projectPath: string | null;
  outputPath: string | null;
  subtitlePath: string | null;
  scriptPath: string | null;
  jobFilePath: string | null;
  sources: Array<{ assetId: string; relPath: string; kind: string; bytes: number }>;
}

export interface EngineInfo {
  version: string;
  office: { id: string; name: string; dir: string; schema: number };
  queue: QueueStats;
  uptimeSeconds: number;
}
