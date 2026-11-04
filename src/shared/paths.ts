/**
 * مسارات التخزين دائمًا ASCII. العنوان العربي يبقى في قاعدة البيانات و manifest.json.
 */
const MAX_SLUG = 40;

export function toSlug(input: string, maxLength = MAX_SLUG): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
}

export function ensureSlug(input: string, fallback: string): string {
  const slug = toSlug(input);
  return slug.length > 0 ? slug : fallback;
}

export function dateStamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function yearMonth(date: Date): { year: string; month: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
  };
}

const SAFE_REL = /^[a-zA-Z0-9._/-]+$/;

/** يرفض المسارات المطلقة و`..` وأي محرف خارج ASCII. */
export function assertRelPath(relPath: string): void {
  if (relPath.length === 0) throw new Error('empty relative path');
  if (relPath.startsWith('/') || relPath.startsWith('\\')) throw new Error('absolute path rejected');
  if (/^[a-zA-Z]:/.test(relPath)) throw new Error('windows absolute path rejected');
  if (relPath.split(/[\\/]/).some((part) => part === '..')) throw new Error('traversal rejected');
  const normalized = relPath.replace(/\\/g, '/');
  if (!SAFE_REL.test(normalized)) throw new Error('non-ascii relative path rejected');
}

export function normalizeRel(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  assertRelPath(normalized);
  return normalized;
}

export function joinRel(...parts: string[]): string {
  const joined = parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  return normalizeRel(joined);
}

export function eventRelPath(params: {
  occurredAt: Date;
  kind: string;
  slug: string;
}): string {
  const stamp = dateStamp(params.occurredAt);
  const year = String(params.occurredAt.getFullYear());
  const month = String(params.occurredAt.getMonth() + 1).padStart(2, '0');
  return joinRel('10_events', year, month, `${stamp}_${params.kind}_${params.slug}`);
}

export function appendRel(base: string, ...parts: string[]): string {
  return joinRel(base, ...parts);
}

export function parentRel(relPath: string): string {
  const parts = normalizeRel(relPath).split('/');
  parts.pop();
  return parts.join('/');
}

export function baseName(relPath: string): string {
  const normalized = normalizeRel(relPath);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
