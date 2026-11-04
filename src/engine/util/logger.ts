import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  recent(limit?: number): LogRecord[];
}

export interface LogRecord {
  at: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  file?: string;
  console?: boolean;
  maxFileBytes?: number;
}

class FileLogger implements Logger {
  private readonly bindings: Record<string, unknown>;
  private readonly level: LogLevel;
  private readonly file: string | undefined;
  private readonly consoleEnabled: boolean;
  private readonly maxFileBytes: number;
  private readonly ring: LogRecord[] = [];
  private currentDay = '';

  constructor(options: LoggerOptions, bindings: Record<string, unknown> = {}) {
    this.level = options.level ?? 'info';
    this.file = options.file;
    this.consoleEnabled = options.console ?? false;
    this.maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
    this.bindings = bindings;
    if (this.file) mkdirSync(dirname(this.file), { recursive: true });
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    const record: LogRecord = {
      at: new Date().toISOString(),
      level,
      message,
      ...(data ? { data: { ...this.bindings, ...data } } : { data: this.bindings }),
    };
    this.ring.push(record);
    if (this.ring.length > 1000) this.ring.shift();
    if (this.consoleEnabled) {
      const line = `[${record.at}] ${level.toUpperCase()} ${message}`;
      // stdout مخصص لبروتوكول بدء التشغيل، لذلك السجلات إلى stderr.
      process.stderr.write(`${line}\n`);
    }
    if (!this.file) return;
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // السجل لا يجب أن يُسقط المحرّك.
    }
  }

  private rotateIfNeeded(): void {
    if (!this.file) return;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.currentDay) {
      this.currentDay = day;
      return;
    }
    if (!existsSync(this.file)) return;
    const size = statSync(this.file).size;
    if (size < this.maxFileBytes) return;
    const rotated = join(dirname(this.file), `${this.file.split(/[\\/]/).pop()}.1`);
    try {
      renameSync(this.file, rotated);
    } catch {
      // تجاهل فشل الدوران.
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('debug', message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.write('info', message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.write('warn', message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.write('error', message, data);
  }
  child(bindings: Record<string, unknown>): Logger {
    return new FileLogger(
      {
        level: this.level,
        file: this.file,
        console: this.consoleEnabled,
        maxFileBytes: this.maxFileBytes,
      },
      { ...this.bindings, ...bindings },
    );
  }
  recent(limit = 200): LogRecord[] {
    return this.ring.slice(-limit);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new FileLogger(options);
}
