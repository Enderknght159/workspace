import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  run(...params: SqlValue[]): RunResult;
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * السائق الافتراضي: node:sqlite المدمجة.
 * كل الكود يستخدم SqliteDriver فقط، حتى يمكن استبدالها بـ better-sqlite3 دون لمس الخدمات.
 */
export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.db.prepare(sql);
    return {
      run: (...params: SqlValue[]): RunResult => {
        const result = statement.run(...params);
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        };
      },
      get: (...params: SqlValue[]): unknown => statement.get(...params),
      all: (...params: SqlValue[]): unknown[] => statement.all(...params),
    };
  }

  close(): void {
    this.db.close();
  }
}

export function openDriver(file: string): SqliteDriver {
  return new NodeSqliteDriver(file);
}
