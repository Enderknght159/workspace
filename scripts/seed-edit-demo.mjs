/**
 * ينشئ حدثًا ومهمة مونتاج تجريبية لاختبار جسر Premiere.
 * node scripts/seed-edit-demo.mjs http://127.0.0.1:45900 devtoken <volumeRoot> <sourceDir>
 */
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:45900';
const token = process.argv[3] ?? 'devtoken';
const volumeRoot = process.argv[4];
const source = process.argv[5];

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload.data;
}

mkdirSync(volumeRoot, { recursive: true });
const volumes = await api('/api/volumes');
let volume = volumes.find((entry) => entry.kind === 'hot');
if (!volume) {
  volume = await api('/api/volumes/register', 'POST', {
    root: volumeRoot,
    label: 'قرص الاختبار',
    kind: 'hot',
  });
}

const events = await api('/api/events?limit=10');
let event = events.items[0];
if (!event) {
  const batch = await api('/api/ingest/start', 'POST', {
    source,
    title: 'درس تجربة بريمير',
    kind: 'lesson',
    occurredAt: '2026-11-06',
    slug: 'premiere-demo',
  });
  for (let i = 0; i < 200; i += 1) {
    const batches = await api('/api/ingest/batches');
    const current = batches.find((entry) => entry.id === batch.id);
    if (current?.state === 'completed') {
      event = await api(`/api/events/${current.eventId}`);
      break;
    }
    if (current?.state === 'failed') throw new Error(current.error ?? 'ingest failed');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const task = await api('/api/edit-tasks', 'POST', {
  eventId: event.id,
  kind: 'full',
  title: 'مونتاج تجربة بريمير',
});
console.log(JSON.stringify(task, null, 2));
