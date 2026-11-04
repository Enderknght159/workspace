import { useState } from 'react';
import type { EventKind } from '../../shared/constants.js';
import type { EventSummary, Page } from '../../shared/models.js';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { navigate, useApi, useDebounced } from '../lib/hooks';
import { Button, Card, EmptyState, Field, Input, Modal, SectionHeader, Select } from '../components/ui';
import { Icon } from '../components/Icon';
import { EventStatus } from '../components/StatusBadge';
import { eventKindLabel } from '../lib/labels';
import { formatDate, eventCountLabel } from '../lib/format';

const KINDS: EventKind[] = ['lesson', 'khutbah', 'event', 'photoshoot', 'other'];
const STATES = [
  ['', 'كل الحالات'],
  ['draft', 'مسودة'],
  ['ingested', 'وارد'],
  ['todo', 'للعمل'],
  ['in_progress', 'قيد التنفيذ'],
  ['in_review', 'للمراجعة'],
  ['approved', 'معتمد'],
  ['published', 'منشور'],
  ['archived', 'مؤرشف'],
  ['cold', 'الهارد البارد'],
];

export function Library() {
  const { toast, poke } = useApp();
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: '',
    kind: 'lesson' as EventKind,
    occurredAt: new Date().toISOString().slice(0, 10),
  });
  const debounced = useDebounced(search);
  const query = new URLSearchParams({ limit: '100', offset: '0' });
  if (debounced.trim()) query.set('q', debounced.trim());
  if (state) query.set('state', state);
  const events = useApi<Page<EventSummary>>(`/api/events?${query.toString()}`);

  async function createEvent() {
    if (form.title.trim().length < 2) {
      toast('اكتب عنوانًا واضحًا للحدث.', 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await api<EventSummary>('/api/events', {
        method: 'POST',
        body: form,
      });
      toast('أُنشئ الحدث. افرّغ ملفاته أو أضف وظيفة.', 'success');
      setModalOpen(false);
      setForm({ title: '', kind: 'lesson', occurredAt: new Date().toISOString().slice(0, 10) });
      poke();
      navigate(`/events/${created.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر إنشاء الحدث.', 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <SectionHeader
          title="المكتبة"
          description="كل حدث وأصوله وحالته في مكان واحد."
          action={
            <Button variant="primary" icon="plus" onClick={() => setModalOpen(true)}>
              حدث جديد
            </Button>
          }
        />
        <div className="toolbar">
          <div className="search">
            <Icon name="library" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالعنوان…"
              aria-label="بحث"
            />
          </div>
          <Select value={state} onChange={(event) => setState(event.target.value)} className="toolbar__select">
            {STATES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <span className="muted small">{eventCountLabel(events.data?.total ?? 0)}</span>
        </div>
      </Card>

      {events.data && events.data.items.length > 0 ? (
        <div className="event-grid">
          {events.data.items.map((event) => (
            <a className="event-card" href={`#/events/${event.id}`} key={event.id}>
              <div className="event-card__top">
                <span className="event-card__kind">
                  <Icon name={event.kind === 'photoshoot' ? 'library' : 'film'} size={18} />
                  {eventKindLabel(event.kind)}
                </span>
                <EventStatus state={event.state} />
              </div>
              <h3>{event.title}</h3>
              <div className="event-card__meta">
                <span>{formatDate(event.occurredAt)}</span>
                <span>·</span>
                <span>{event.assetCount} أصل</span>
                <span>·</span>
                <span>{event.jobCount} وظيفة</span>
              </div>
              {event.openJobCount > 0 && (
                <div className="event-card__foot">
                  <span className="pulse" />
                  {event.openJobCount} وظيفة مفتوحة
                </div>
              )}
              <code className="event-card__path" dir="ltr">
                {event.relPath ?? 'دون مجلد بعد'}
              </code>
            </a>
          ))}
        </div>
      ) : events.loading ? (
        <Card>
          <div className="loading-row">
            <span className="spinner" />
            <span className="muted">تحميل المكتبة…</span>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="library"
            title={search || state ? 'لا نتائج مطابقة' : 'المكتبة فارغة'}
            description={
              search || state
                ? 'جرّب بحثًا أوسع أو أزل عامل التصفية.'
                : 'ابدأ بتفريغ بطاقة أو أنشئ حدثًا يدويًا ثم أضف وظيفة.'
            }
            action={
              <div className="row gap">
                <a className="btn btn--primary btn--sm" href="#/inbox">
                  تفريغ بطاقة
                </a>
                <Button size="sm" icon="plus" onClick={() => setModalOpen(true)}>
                  حدث جديد
                </Button>
              </div>
            }
          />
        </Card>
      )}

      <Modal
        open={modalOpen}
        title="حدث جديد"
        description="الحدث هو الوعاء: درس، خطبة، فعالية، أو جلسة تصوير."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" onClick={() => void createEvent()} loading={creating}>
              إنشاء
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="العنوان" span required>
            <Input
              autoFocus
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="مثال: درس بر الوالدين"
            />
          </Field>
          <Field label="النوع">
            <Select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as EventKind })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {eventKindLabel(kind)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="التاريخ">
            <Input
              type="date"
              value={form.occurredAt}
              onChange={(event) => setForm({ ...form, occurredAt: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
