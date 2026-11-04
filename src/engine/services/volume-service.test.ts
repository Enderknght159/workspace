import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import { withOffice } from '../testing/harness.js';
import { fingerprintFile, readFingerprint, writeFingerprint } from '../services/volume-identity.js';

describe('volume identity', () => {
  it('registers a volume, writes a fingerprint, and makes it the default hot', async () => {
    await withOffice(({ office, volumeRoot }) => {
      const volume = office.volumes.register(
        { root: volumeRoot, label: 'Media', kind: 'hot' },
        'usr_local',
        office.config.id,
      );

      expect(volume.root).toBe(volumeRoot);
      expect(existsSync(fingerprintFile(volumeRoot))).toBe(true);
      const fingerprint = readFingerprint(volumeRoot);
      expect(fingerprint?.volume_id).toBe(volume.id);
      expect(fingerprint?.offices).toContain(office.config.id);
      expect(office.volumes.defaultHot()?.id).toBe(volume.id);

      const audit = office.audit.list({ entity: 'volume', entityId: volume.id });
      expect(audit[0]?.action).toBe('volume.register');
    });
  });

  it('detects a copied fingerprint on a different physical disk', async () => {
    await withOffice(
      ({ office, root, volumeRoot }) => {
        const first = office.volumes.register(
          { root: volumeRoot, label: 'Original', kind: 'hot' },
          null,
          office.config.id,
        );
        const cloneRoot = join(root, 'clone');
        writeFingerprint(cloneRoot, {
          id: first.id,
          label: 'Clone',
          kind: 'hot',
          officeId: office.config.id,
        });

        let failure: unknown;
        try {
          office.volumes.register({ root: cloneRoot, label: 'Clone', kind: 'hot' }, null, office.config.id);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(AppError);
        expect((failure as AppError).code).toBe('WS-2004');
        expect(office.volumes.get(first.id)?.root).toBe(volumeRoot);
      },
      {
        probe: (rootPath) => ({
          volumeGuid: rootPath.includes('clone') ? 'GUID-CLONE' : 'GUID-ORIGINAL',
          serial: null,
          fsType: 'NTFS',
          sizeBytes: 1_000_000,
        }),
      },
    );
  });

  it('marks a disconnected volume as offline on scan', async () => {
    await withOffice(({ office, root, volumeRoot }) => {
      const volume = office.volumes.register(
        { root: volumeRoot, label: 'Hot', kind: 'hot' },
        null,
        office.config.id,
      );
      renameSync(volumeRoot, join(root, 'volume-moved'));
      const scanned = office.volumes.scan();
      expect(scanned.find((entry) => entry.id === volume.id)?.status).toBe('offline');
    });
  });

  it('marks a volume as foreign when its fingerprint id differs', async () => {
    await withOffice(({ office, volumeRoot }) => {
      const volume = office.volumes.register(
        { root: volumeRoot, label: 'Hot', kind: 'hot' },
        null,
        office.config.id,
      );
      const file = fingerprintFile(volumeRoot);
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      parsed.volume_id = 'vol_OTHER';
      writeFileSync(file, JSON.stringify(parsed));

      office.volumes.scan();
      expect(office.volumes.get(volume.id)?.status).toBe('foreign');
    });
  });

  it('remounts a volume when its drive letter changes', async () => {
    let movedRoot = '';
    await withOffice(
      ({ office, root, volumeRoot }) => {
        const volume = office.volumes.register(
          { root: volumeRoot, label: 'Hot', kind: 'hot' },
          null,
          office.config.id,
        );
        movedRoot = join(root, 'drive-Z');
        renameSync(volumeRoot, movedRoot);
        const scanned = office.volumes.scan();
        const view = scanned.find((entry) => entry.id === volume.id);
        expect(view?.root).toBe(movedRoot);
        expect(view?.status).toBe('connected');
      },
      {
        listMounts: () =>
          movedRoot
            ? [{ root: movedRoot, volumeGuid: null, serial: null, fsType: null, sizeBytes: null }]
            : [],
      },
    );
  });
});
