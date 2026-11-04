/**
 * بيانات تجريبية لتطوير الواجهة. لا تُستخدم في الإنتاج.
 * الاستخدام: node scripts/seed-demo.mjs http://127.0.0.1:45871 devtoken
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.argv[2] ?? 'http://127.0.0.1:45871';
const token = process.argv[3] ?? 'devtoken';

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload.data;
}

const root = process.env.SEED_VOLUME ?? join(tmpdir(), 'workspace-ui-demo-volume');
mkdirSync(root, { recursive: true });

const volumes = await api('/api/volumes');
let volume = volumes.find((entry) => entry.kind === 'hot');
if (!volume) {
  volume = await api('/api/volumes/register', 'POST', {
    root,
    label: 'قرص المكتب',
    kind: 'hot',
  });
}
console.log('volume', volume.id);

const source = process.env.SEED_SOURCE ?? join(tmpdir(), 'workspace-ui-demo-card');
mkdirSync(source, { recursive: true });
writeFileSync(join(source, 'lesson-intro.mp4'), 'demo video bytes', 'utf8');
writeFileSync(join(source, 'lesson-cover.jpg'), 'demo image bytes', 'utf8');

const existingEvents = await api('/api/events?limit=5');
if (existingEvents.total === 0) {
  const batch = await api('/api/ingest/start', 'POST', {
    source,
    title: 'درس بر الوالدين',
    kind: 'lesson',
    occurredAt: '2026-11-04',
    slug: 'abu-bakr',
  });
  console.log('batch', batch.id);
  for (let index = 0; index < 100; index += 1) {
    const batches = await api('/api/ingest/batches');
    const current = batches.find((entry) => entry.id === batch.id);
    if (current?.state === 'completed') break;
    if (current?.state === 'failed') throw new Error(current.error ?? 'ingest failed');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const events = await api('/api/events?limit=5');
const event = events.items[0];
console.log('event', event.id, event.title);

const jobs = await api(`/api/jobs?eventId=${event.id}`);
if (jobs.length === 0) {
  const job = await api('/api/jobs', 'POST', {
    eventId: event.id,
    kind: 'edit',
    mode: 'manual',
    maxMinutes: 5,
  });
  console.log('job', job.id);
  for (let index = 0; index < 200; index += 1) {
    const current = await api(`/api/jobs/${job.id}`);
    if (current.state === 'review_pending') {
      console.log('ready for review');
      break;
    }
    if (['failed', 'cancelled'].includes(current.state)) {
      throw new Error(`job ${current.state}: ${current.errorMessage ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const second = await api('/api/events', 'POST', {
  title: 'خطبة الجمعة — الصبر',
  kind: 'khutbah',
  occurredAt: '2026-10-30',
  slug: 'patience',
});
await api(`/api/events/${second.id}/transition`, 'POST', { to: 'ingested' });
console.log('seeded');
