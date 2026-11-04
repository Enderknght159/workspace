import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Office } from '../office/office.js';
import { startHttpServer, type EngineHttpServer } from './server.js';
import { makeTempDir } from '../testing/harness.js';
import { createLogger } from '../util/logger.js';
import { UNKNOWN_IDENTITY } from '../services/volume-identity.js';

const TOKEN = 'test-token';

describe('engine http api', () => {
  let root: string;
  let office: Office;
  let http: EngineHttpServer;
  let base: string;

  beforeAll(async () => {
    root = makeTempDir('http-test-');
    const volumeRoot = join(root, 'volume');
    mkdirSync(volumeRoot, { recursive: true });
    office = Office.open({
      dir: join(root, 'office'),
      logger: createLogger({ level: 'error' }),
      volumeProbe: () => UNKNOWN_IDENTITY,
    });
    office.volumes.register({ root: volumeRoot, label: 'Hot', kind: 'hot' }, null, office.config.id);
    http = await startHttpServer({ office, token: TOKEN, port: 0 });
    base = `http://127.0.0.1:${http.port}`;
  });

  afterAll(async () => {
    await http.close();
    office.close();
  });

  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  it('rejects requests without a token', async () => {
    const response = await fetch(`${base}/api/info`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('WS-0004');
  });

  it('returns office info and queue stats', async () => {
    const response = await api('/api/info');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { office: { id: string }; queue: { queued: number } } };
    expect(body.data.office.id).toBe(office.config.id);
    expect(body.data.queue.queued).toBe(0);
  });

  it('creates and lists events', async () => {
    const create = await api('/api/events', {
      method: 'POST',
      body: JSON.stringify({ kind: 'lesson', title: 'درس عبر الواجهة', occurredAt: '2026-11-04' }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as { data: { id: string; state: string } };
    expect(created.data.state).toBe('draft');

    const list = await api('/api/events?limit=10');
    const page = (await list.json()) as { data: { total: number; items: Array<{ id: string }> } };
    expect(page.data.total).toBe(1);
    expect(page.data.items[0]?.id).toBe(created.data.id);
  });

  it('validates request bodies', async () => {
    const response = await api('/api/events', {
      method: 'POST',
      body: JSON.stringify({ kind: 'lesson' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('WS-0003');
    expect(body.error.details).toBeTruthy();
  });

  it('protects settings with the elevation password', async () => {
    const patchWithoutElevation = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ ui: { theme: 'light' } }),
    });
    expect(patchWithoutElevation.status).toBe(200);

    const setPassword = await api('/api/security/password', {
      method: 'POST',
      body: JSON.stringify({ password: 'office-secret' }),
    });
    expect(setPassword.status).toBe(200);
    const setBody = (await setPassword.json()) as { data: { recoveryCode: string } };
    expect(setBody.data.recoveryCode).toHaveLength(10);

    const blocked = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ ui: { theme: 'dark' } }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('WS-8001');

    const wrong = await api('/api/elevate', {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);

    const elevate = await api('/api/elevate', {
      method: 'POST',
      body: JSON.stringify({ password: 'office-secret' }),
    });
    expect(elevate.status).toBe(200);
    const elevated = (await elevate.json()) as { data: { token: string } };

    const allowed = await api('/api/settings', {
      method: 'PATCH',
      headers: { 'x-elevation': elevated.data.token },
      body: JSON.stringify({ ui: { theme: 'light' } }),
    });
    expect(allowed.status).toBe(200);

    const status = await api('/api/security/status', {
      headers: { 'x-elevation': elevated.data.token },
    });
    const statusBody = (await status.json()) as { data: { hasPassword: boolean; elevatedUntil: string | null } };
    expect(statusBody.data.hasPassword).toBe(true);
    expect(statusBody.data.elevatedUntil).toBeTruthy();
  });
});
