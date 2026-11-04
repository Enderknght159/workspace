export const APP_SCHEMA = 1;
export const APP_NAME = 'Workspace';
export const APP_VERSION = '0.1.0';

/** أنواع الأحداث المدعومة في v0.1 (قابلة للتوسعة دون تغيير الجداول). */
export const EVENT_KINDS = [
  'lesson',
  'khutbah',
  'event',
  'photoshoot',
  'other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const ASSET_KINDS = ['video', 'audio', 'image', 'document', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const JOB_KINDS = [
  'ingest',
  'transcribe',
  'edit',
  'thumbnail',
  'reel',
  'export',
  'publish',
  'archive',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_MODES = ['manual', 'auto', 'hybrid'] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const VOLUME_KINDS = ['hot', 'cold'] as const;
export type VolumeKind = (typeof VOLUME_KINDS)[number];

export const VOLUME_STATUSES = [
  'connected',
  'offline',
  'cloned',
  'fingerprint_missing',
  'foreign',
  'unregistered',
] as const;
export type VolumeStatus = (typeof VOLUME_STATUSES)[number];

export const REVIEW_DECISIONS = ['approved', 'revision', 'rejected'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const MEDIA_EXTENSIONS: Record<string, AssetKind> = {
  '.mp4': 'video',
  '.mov': 'video',
  '.mkv': 'video',
  '.m4v': 'video',
  '.avi': 'video',
  '.webm': 'video',
  '.mts': 'video',
  '.m2ts': 'video',
  '.wav': 'audio',
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.flac': 'audio',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.webp': 'image',
  '.heic': 'image',
  '.dng': 'image',
  '.cr2': 'image',
  '.nef': 'image',
  '.arw': 'image',
  '.pdf': 'document',
};

/** حدود المساحة بالبايت (من الخطة §8). */
export const SPACE_LIMITS = {
  warnBelow: 60 * 1024 ** 3,
  blockBelow: 40 * 1024 ** 3,
  cleanupBelow: 25 * 1024 ** 3,
} as const;

export const DEFAULT_MAX_MINUTES = 120;
export const DEFAULT_TRANSCRIBE_MINUTES = 20;
export const DEFAULT_MAX_ATTEMPTS = 2;
export const DEFAULT_ELEVATION_MINUTES = 10;
export const ARCHIVE_RETENTION_DAYS = 7;
export const TRASH_RETENTION_DAYS = 30;

export const REGISTRY_DIR = '.workspace-office';
export const REGISTRY_FILE = 'volume.json';
