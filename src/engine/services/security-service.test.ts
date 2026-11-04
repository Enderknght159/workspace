import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';
import { AppError } from '../../shared/errors.js';

describe('elevation security', () => {
  it('sets a password, elevates, and recovers with the one-time code', async () => {
    await withOffice(({ office }) => {
      const first = office.security.setPassword('office-secret', 'usr_local');
      expect(first.recoveryCode).toHaveLength(10);
      expect(office.security.hasPassword()).toBe(true);

      const elevation = office.security.elevate('office-secret', 'usr_local');
      expect(elevation.token.length).toBeGreaterThan(10);
      expect(office.security.isElevated(elevation.token)).toBe(true);
      expect(office.security.isElevated('wrong-token')).toBe(false);

      const recovered = office.security.recover(first.recoveryCode, 'new-secret', 'usr_local');
      expect(recovered.recoveryCode).not.toBe(first.recoveryCode);

      let failure: unknown;
      try {
        office.security.elevate('office-secret', 'usr_local');
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AppError);
      expect(office.security.elevate('new-secret', 'usr_local').token).toBeTruthy();
    });
  });
});
