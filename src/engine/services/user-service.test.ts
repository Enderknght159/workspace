import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';

describe('local users', () => {
  it('creates, renames, deactivates and audits users', async () => {
    await withOffice(({ office }) => {
      const created = office.users.create({ name: 'أحمد', role: 'editor' }, 'usr_local');
      expect(created.name).toBe('أحمد');
      expect(created.active).toBe(true);
      expect(office.users.active(created.id)?.name).toBe('أحمد');

      const updated = office.users.update(
        created.id,
        { name: 'أحمد علي', role: 'reviewer' },
        'usr_local',
      );
      expect(updated.role).toBe('reviewer');
      expect(office.users.update(created.id, { active: false }, 'usr_local').active).toBe(false);
      expect(office.users.active(created.id)).toBeNull();

      const audit = office.audit.list({ entity: 'user', entityId: created.id });
      expect(audit.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['user.create', 'user.update']),
      );
    });
  });
});
