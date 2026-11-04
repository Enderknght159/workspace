import { describe, expect, it } from 'vitest';
import {
  assertRelPath,
  ensureSlug,
  eventRelPath,
  normalizeRel,
  toSlug,
} from '../shared/paths.js';

describe('storage paths', () => {
  it('accepts only ascii relative paths', () => {
    expect(normalizeRel('10_events/2026/11/abc')).toBe('10_events/2026/11/abc');
    expect(() => assertRelPath('../etc/passwd')).toThrow();
    expect(() => assertRelPath('C:/Windows')).toThrow();
    expect(() => assertRelPath('/root')).toThrow();
    expect(() => assertRelPath('10_events/درس')).toThrow();
  });

  it('builds dated event paths', () => {
    expect(
      eventRelPath({ occurredAt: new Date('2026-11-04T12:00:00'), kind: 'lesson', slug: 'abu-bakr' }),
    ).toBe('10_events/2026/11/20261104_lesson_abu-bakr');
  });

  it('keeps arabic titles out of storage slugs', () => {
    expect(toSlug('درس بر الوالدين')).toBe('');
    expect(ensureSlug('درس بر الوالدين', 'lesson')).toBe('lesson');
    expect(toSlug('Friday Lesson 01')).toBe('friday-lesson-01');
  });
});
