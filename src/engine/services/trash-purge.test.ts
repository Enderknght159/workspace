import { utimesSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withOffice } from '../testing/harness.js';

describe('trash purge', () => {
  it('removes only trash folders older than the policy', async () => {
    await withOffice(({ office, volumeRoot }) => {
      office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
      const trash = join(volumeRoot, '90_trash');
      const oldDir = join(trash, 'old');
      const freshDir = join(trash, 'fresh');
      mkdirSync(oldDir, { recursive: true });
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(oldDir, 'a.bin'), 'old');
      const old = new Date(Date.now() - 40 * 86_400_000);
      utimesSync(oldDir, old, old);

      office.settings.update({ archive: { trashDays: 30 } }, null);
      const result = office.archive.purgeTrash();
      expect(result.removed).toBe(1);
    });
  });
});
