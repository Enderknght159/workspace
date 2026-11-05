import { AppError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { User } from '../../shared/models.js';
import type { Database } from '../db/database.js';
import type { AuditService } from './audit-service.js';

interface UserRow {
  id: string;
  name: string;
  role: string;
  active: number;
  created_at: string;
}

export class UserService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(): User[] {
    return this.db
      .all<UserRow>('SELECT * FROM users ORDER BY active DESC, created_at ASC')
      .map(mapUser);
  }

  get(id: string): User {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (!row) throw new AppError('WS-0002', { userId: id });
    return mapUser(row);
  }

  active(id: string): User | null {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', id);
    return row ? mapUser(row) : null;
  }

  create(input: { name: string; role: string }, actorId: string | null): User {
    const id = newId('usr');
    const now = new Date().toISOString();
    this.db.run(
      'INSERT INTO users (id, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)',
      id,
      input.name.trim(),
      input.role,
      now,
    );
    this.audit.record({
      actorId,
      action: 'user.create',
      entity: 'user',
      entityId: id,
      after: { name: input.name, role: input.role },
      elevated: true,
    });
    return this.get(id);
  }

  update(
    id: string,
    patch: { name?: string; role?: string; active?: boolean },
    actorId: string | null,
  ): User {
    const before = this.get(id);
    this.db.run(
      'UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?',
      patch.name?.trim() ?? before.name,
      patch.role ?? before.role,
      patch.active === undefined ? (before.active ? 1 : 0) : patch.active ? 1 : 0,
      id,
    );
    this.audit.record({
      actorId,
      action: 'user.update',
      entity: 'user',
      entityId: id,
      before,
      after: { ...before, ...patch },
      elevated: true,
    });
    return this.get(id);
  }
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}
