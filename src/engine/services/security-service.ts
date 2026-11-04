import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DEFAULT_ELEVATION_MINUTES } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import type { AuditService } from './audit-service.js';
import type { SettingsService } from './settings-service.js';
import type { Logger } from '../util/logger.js';
import { randomToken } from '../util/misc.js';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

interface ElevationSession {
  expiresAt: number;
}

export interface ElevationResult {
  token: string;
  expiresAt: string | null;
}

export interface SecurityStatus {
  hasPassword: boolean;
  elevatedUntil: string | null;
  lockedForSeconds: number;
}

/**
 * حماية من الخطأ لا من الخائن: كلمة مرور مشتركة على جهاز مشترك.
 * لا تُخزَّن كلمة المرور، ويُسجَّل كل استخدام.
 */
export class SecurityService {
  private readonly sessions = new Map<string, ElevationSession>();
  private attempts: number[] = [];
  private lockedUntil = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  hasPassword(): boolean {
    return this.settings.get().security.elevationHash !== null;
  }

  status(token: string | null): SecurityStatus {
    this.prune();
    const session = token ? this.sessions.get(token) : null;
    return {
      hasPassword: this.hasPassword(),
      elevatedUntil: session ? new Date(session.expiresAt).toISOString() : null,
      lockedForSeconds: Math.max(0, Math.ceil((this.lockedUntil - Date.now()) / 1000)),
    };
  }

  setPassword(password: string, actorId: string | null): { recoveryCode: string } {    if (password.length < 6) throw new AppError('WS-0003', { field: 'password', minLength: 6 });
    const recoveryCode = randomBytes(5).toString('hex').toUpperCase();
    this.settings.update(
      {
        security: {
          elevationHash: hashSecret(password),
          recoveryHash: hashSecret(recoveryCode),
        },
      },
      actorId,
    );
    this.audit.record({
      actorId,
      action: 'security.password_set',
      entity: 'settings',
      entityId: 'office.settings',
      elevated: true,
    });
    this.logger.info('security.password_set');
    return { recoveryCode };
  }

  elevate(password: string, actorId: string | null): ElevationResult {    const hash = this.settings.get().security.elevationHash;
    if (!hash) {
      return { token: 'open', expiresAt: null };
    }
    this.prune();
    if (Date.now() < this.lockedUntil) {
      throw new AppError('WS-8003', {
        retryAfterSeconds: Math.ceil((this.lockedUntil - Date.now()) / 1000),
      });
    }
    if (!verifySecret(password, hash)) {
      this.attempts.push(Date.now());
      this.attempts = this.attempts.filter((at) => Date.now() - at < WINDOW_MS);
      if (this.attempts.length >= MAX_ATTEMPTS) {
        this.lockedUntil = Date.now() + WINDOW_MS;
        this.attempts = [];
        this.audit.record({
          actorId,
          action: 'security.lockout',
          entity: 'settings',
          entityId: 'office.settings',
        });
      }
      throw new AppError('WS-8002', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - this.attempts.length) });
    }
    this.attempts = [];
    const minutes = this.settings.get().security.idleLockMinutes || DEFAULT_ELEVATION_MINUTES;
    const token = randomToken(24);
    const expiresAt = Date.now() + minutes * 60_000;
    this.sessions.set(token, { expiresAt });
    this.audit.record({
      actorId,
      action: 'security.elevated',
      entity: 'settings',
      entityId: 'office.settings',
      elevated: true,
    });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  isElevated(token: string | null): boolean {    if (!this.hasPassword()) return true;
    if (!token) return false;
    this.prune();
    const session = this.sessions.get(token);
    return session !== undefined && session.expiresAt > Date.now();
  }

  requireElevation(token: string | null): void {
    if (!this.isElevated(token)) throw new AppError('WS-8001');
  }

  /** استرداد بكلمة المرور عند نسيانها. يستهلك رمز الاسترداد ويولّد رمزًا جديدًا. */
  recover(recoveryCode: string, newPassword: string, actorId: string | null): { recoveryCode: string } {
    const stored = this.settings.get().security.recoveryHash;
    if (!stored) throw new AppError('WS-8001', { reason: 'no_recovery_code' });
    const normalized = recoveryCode.trim().toUpperCase();
    if (!verifySecret(normalized, stored)) throw new AppError('WS-8002', { reason: 'bad_recovery_code' });
    const result = this.setPassword(newPassword, actorId);
    this.audit.record({
      actorId,
      action: 'security.recovered',
      entity: 'settings',
      entityId: 'office.settings',
      elevated: true,
    });
    return result;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 96 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltBase64, hashBase64] = parts;
  try {
    const salt = Buffer.from(saltBase64 ?? '', 'base64');
    const expected = Buffer.from(hashBase64 ?? '', 'base64');
    const derived = scryptSync(secret.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 96 * 1024 * 1024,
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
