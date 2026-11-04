import type { SqliteDriver, SqlValue } from './driver.js';

/**
 * غلاف رقيق: ترجمة bigint، معاملات متداخلة، وواجهة واحدة للاستعلامات.
 * لا تستخدم أي خدمة `DatabaseSync` مباشرة.
 */
export class Database {
  private depth = 0;

  constructor(
    private readonly driver: SqliteDriver,
    readonly file: string,
  ) {}

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    return this.driver.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.driver.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.driver.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      const savepoint = `sp_${this.depth}`;
      this.depth += 1;
      this.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = fn();
        this.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        this.exec(`ROLLBACK TO ${savepoint}`);
        this.exec(`RELEASE ${savepoint}`);
        throw error;
      } finally {
        this.depth -= 1;
      }
    }
    this.depth = 1;
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.exec('ROLLBACK');
      } catch {
        // تجاهل فشل التراجع إن لم تكن المعاملة مفتوحة.
      }
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.driver.close();
  }
}
