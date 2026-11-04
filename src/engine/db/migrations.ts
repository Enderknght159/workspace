import { AppError } from '../../shared/errors.js';
import type { Database } from './database.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE office (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE volumes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hot', 'cold')),
  status TEXT NOT NULL,
  volume_guid TEXT,
  serial TEXT,
  fs_type TEXT,
  size_bytes INTEGER,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_volumes_status ON volumes(status);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  title_slug TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  state TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  volume_id TEXT REFERENCES volumes(id),
  rel_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (volume_id, rel_path)
) STRICT;
CREATE INDEX idx_events_state ON events(state);
CREATE INDEX idx_events_occurred ON events(occurred_at);
CREATE INDEX idx_events_volume ON events(volume_id);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  volume_id TEXT NOT NULL REFERENCES volumes(id),
  rel_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  captured_at TEXT,
  status TEXT NOT NULL DEFAULT 'present',
  duplicate_of TEXT REFERENCES assets(id),
  created_at TEXT NOT NULL,
  UNIQUE (volume_id, rel_path)
) STRICT;
CREATE INDEX idx_assets_sha ON assets(sha256);
CREATE INDEX idx_assets_event ON assets(event_id);
CREATE INDEX idx_assets_volume ON assets(volume_id);

CREATE TABLE placements (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  volume_id TEXT NOT NULL REFERENCES volumes(id),
  rel_path TEXT NOT NULL,
  role TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, volume_id, rel_path)
) STRICT;
CREATE INDEX idx_placements_volume ON placements(volume_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  style_id TEXT,
  style_version TEXT,
  style_hash TEXT,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  max_minutes INTEGER NOT NULL DEFAULT 120,
  agent_session_id TEXT,
  workspace_rel TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  step TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  parent_job_id TEXT REFERENCES jobs(id),
  revision_reason TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  machine_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE INDEX idx_jobs_event ON jobs(event_id);
CREATE INDEX idx_jobs_created ON jobs(created_at);

CREATE TABLE job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
) STRICT;
CREATE INDEX idx_job_logs_job ON job_logs(job_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES users(id),
  decision TEXT NOT NULL,
  checklist_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_reviews_job ON reviews(job_id);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX idx_publications_job ON publications(job_id);

CREATE TABLE styles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  hash TEXT NOT NULL,
  params_schema_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL DEFAULT '[]',
  checklist_json TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  est_minutes INTEGER NOT NULL DEFAULT 60,
  gpu INTEGER NOT NULL DEFAULT 0,
  preview_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL
) STRICT;

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  jobs_json TEXT NOT NULL
) STRICT;

CREATE TABLE archive_moves (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  from_volume_id TEXT NOT NULL REFERENCES volumes(id),
  to_volume_id TEXT NOT NULL REFERENCES volumes(id),
  rel_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_archive_asset ON archive_moves(asset_id);

CREATE TABLE ingest_batches (
  id TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  state TEXT NOT NULL,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  total_files INTEGER NOT NULL DEFAULT 0,
  copied_files INTEGER NOT NULL DEFAULT 0,
  verified_files INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE ingest_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES ingest_batches(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id),
  message TEXT
) STRICT;
CREATE INDEX idx_ingest_files_batch ON ingest_files(batch_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id TEXT REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'todo',
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL,
  elevated INTEGER NOT NULL DEFAULT 0,
  machine_id TEXT
) STRICT;
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

INSERT INTO users (id, name, role, active, created_at)
VALUES ('usr_local', 'فريق المكتب', 'owner', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`,
  },
];

export { MIGRATIONS };

export function migrate(db: Database): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = db.all<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  const appliedMap = new Map(applied.map((row) => [row.version, row]));

  for (const migration of MIGRATIONS) {
    const checksum = simpleChecksum(migration.sql);
    const existing = appliedMap.get(migration.version);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new AppError('WS-1003', {
          version: migration.version,
          reason: 'checksum_mismatch',
        });
      }
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.run(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        migration.version,
        migration.name,
        checksum,
        new Date().toISOString(),
      );
    });
  }

  return MIGRATIONS.length;
}

function simpleChecksum(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
