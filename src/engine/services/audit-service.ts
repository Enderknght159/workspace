import type { AuditEntry } from '../../shared/models.js';
import { newId } from '../../shared/ids.js';
import type { Database } from '../db/database.js';

export interface AuditInput {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  elevated?: boolean;
  machineId?: string | null;
}

export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly machineId: string,
  ) {}

  record(input: AuditInput): AuditEntry {
    const entry: AuditEntry = {
      id: newId('aud'),
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      at: new Date().toISOString(),
      elevated: input.elevated ?? false,
      machineId: input.machineId === undefined ? this.machineId : input.machineId,
    };
    this.db.run(
      `INSERT INTO audit_log
        (id, actor_id, action, entity, entity_id, before_json, after_json, at, elevated, machine_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.actorId,
      entry.action,
      entry.entity,
      entry.entityId,
      JSON.stringify(entry.before),
      JSON.stringify(entry.after),
      entry.at,
      entry.elevated ? 1 : 0,
      entry.machineId,
    );
    return entry;
  }

  list(options: { limit?: number; offset?: number; entity?: string; entityId?: string } = {}): AuditEntry[] {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = options.entity
      ? options.entityId
        ? this.db.all<AuditRow>(
            'SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY at DESC LIMIT ? OFFSET ?',
            options.entity,
            options.entityId,
            limit,
            offset,
          )
        : this.db.all<AuditRow>(
            'SELECT * FROM audit_log WHERE entity = ? ORDER BY at DESC LIMIT ? OFFSET ?',
            options.entity,
            limit,
            offset,
          )
      : this.db.all<AuditRow>(
          'SELECT * FROM audit_log ORDER BY at DESC LIMIT ? OFFSET ?',
          limit,
          offset,
        );
    return rows.map(mapAuditRow);
  }
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  at: string;
  elevated: number;
  machine_id: string | null;
}

function mapAuditRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    before: row.before_json ? safeParse(row.before_json) : null,
    after: row.after_json ? safeParse(row.after_json) : null,
    at: row.at,
    elevated: row.elevated === 1,
    machineId: row.machine_id,
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
