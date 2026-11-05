import { useState } from 'react';
import type {
  Asset,
  EventDetail as EventDetailModel,
  EventSummary,
  JobSummary,
  MoveJournalEntry,
  Page,
  StyleInfo,
} from '../../shared/models.js';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  Progress,
  SectionHeader,
  Select,
  Spinner,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { EventStatus, JobStatus } from '../components/StatusBadge';
import { MediaPlayer } from '../components/MediaPlayer';
import { formatBytes, formatDate, formatDateTime, shortHash } from '../lib/format';
import { eventKindLabel, jobKindLabel } from '../lib/labels';

interface PlayerState {
  url: string;
  kind: string;
  title: string;
}

export function EventDetail({ eventId }: { eventId: string }) {
  const { toast, poke, runElevated } = useApp();
  const event = useApi<EventDetailModel>(`/api/events/${eventId}`);
  const styles = useApi<StyleInfo[]>('/api/styles');
  const events = useApi<Page<EventSummary>>('/api/events?limit=200&offset=0');
  const [jobOpen, setJobOpen] = useState(false);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [relocateAsset, setRelocateAsset] = useState<Asset | null>(null);
  const [targetEvent, setTargetEvent] = useState('');
  const [relocateMode, setRelocateMode] = useState<'move' | 'copy'>('move');
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [jobForm, setJobForm] = useState({
    kind: 'edit',
    styleId: '',
    mode: 'manual',
    maxMinutes: 120,
  });

  if (event.loading && !event.data) {
    return (
      <Card>
        <Spinner label="تحميل الحدث…" />
      </Card>
    );
  }
  if (event.error || !event.data) {
    return (
      <Card>
        <EmptyState
          icon="alert"
          title="تعذّر فتح الحدث"
          description={event.error?.message ?? 'قد يكون محذوفًا أو غير موجود.'}
          action={
            <a className="btn btn--ghost btn--sm" href="#/library">
              العودة للمكتبة
            </a>
          }
        />
      </Card>
    );
  }

  const detail = event.data;
  const enabledStyles = styles.data?.filter((style) => style.enabled) ?? [];
  const selectedStyle =
    enabledStyles.find((style) => style.id === jobForm.styleId) ?? enabledStyles[0];

  async function transition(to: string) {
    setBusy(true);
    try {
      await api(`/api/events/${detail.id}/transition`, { method: 'POST', body: { to } });
      toast('تم تحديث حالة الحدث.', 'success');
      event.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تحديث الحالة.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openRelocate(asset: Asset) {
    const firstTarget = events.data?.items.find((item) => item.id !== detail.id);
    setTargetEvent(firstTarget?.id ?? '');
    setRelocateMode('move');
    setRelocateAsset(asset);
  }

  async function submitRelocate() {
    if (!relocateAsset || !targetEvent) return;
    setBusy(true);
    try {
      await runElevated(() =>
        api(`/api/assets/${relocateAsset.id}/relocate`, {
          method: 'POST',
          body: { targetEventId: targetEvent, mode: relocateMode },
        }),
      );
      toast('نُقل الأصل إلى الحدث الهدف.', 'success');
      setRelocateAsset(null);
      event.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر نقل الأصل.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function undoMove(asset: Asset) {
    try {
      const entry = await api<MoveJournalEntry | null>(`/api/assets/${asset.id}/move`);
      if (!entry || entry.state !== 'completed') {
        toast('لا يوجد نقل مكتمل قابل للتراجع لهذا الأصل.', 'error');
        return;
      }
      if (!window.confirm(`إعادة الملف إلى المصدر؟\n${entry.sourcePath}`)) return;
      await runElevated(() => api(`/api/moves/${entry.id}/undo`, { method: 'POST' }));
      toast('أُعيد الملف إلى المصدر بعد التحقق.', 'success');
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر التراجع.', 'error');
    }
  }

  async function trashSources() {
    if (confirmTitle.trim() !== detail.title.trim()) {
      toast('اكتب اسم الحدث كما هو للتأكيد.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await runElevated(() =>
        api<{ moved: number; bytes: number }>(`/api/events/${detail.id}/sources/trash`, {
          method: 'POST',
          body: { keepOutputs: true, confirmTitle },
        }),
      );
      toast(`نُقل ${result.moved} ملف خام إلى السلة، مع الإبقاء على المخرجات.`, 'success');
      setTrashOpen(false);
      setConfirmTitle('');
      event.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر حذف الخام.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {    setBusy(true);
    try {
      const job = await api<JobSummary>('/api/jobs', {
        method: 'POST',
        body: {
          eventId: detail.id,
          kind: jobForm.kind,
          mode: jobForm.mode,
          styleId: selectedStyle?.id ?? null,
          maxMinutes: jobForm.maxMinutes,
        },
      });
      toast(
        jobForm.mode === 'auto'
          ? 'أُضيفت الوظيفة إلى الطابور الليلي.'
          : 'أُضيفت الوظيفة إلى الطابور.',
        'success',
      );
      setJobOpen(false);
      event.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر إنشاء الوظيفة.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const primaryAction = (() => {
    if (detail.state === 'draft') return { label: 'تأكيد الاستلام', to: 'ingested', icon: 'check' as const };
    if (detail.state === 'ingested') return { label: 'ابدأ العمل', to: 'in_progress', icon: 'play' as const };
    if (detail.state === 'todo') return { label: 'ابدأ العمل', to: 'in_progress', icon: 'play' as const };
    return null;
  })();

  return (
    <div className="stack">
      <Card className="detail-head">
        <div className="detail-head__main">
          <div className="detail-head__meta">
            <span className="eyebrow">{eventKindLabel(detail.kind)}</span>
            <span className="muted tiny">{formatDate(detail.occurredAt)}</span>
            <EventStatus state={detail.state} />
          </div>
          <h2>{detail.title}</h2>
          <div className="detail-head__sub">
            <span>{detail.assets.length} أصل</span>
            <span>·</span>
            <span>{detail.jobs.length} وظيفة</span>
            <span>·</span>
            <span>آخر تحديث {formatDateTime(detail.updatedAt)}</span>
          </div>
        </div>
        <div className="detail-head__actions">
          {primaryAction && (
            <Button
              variant="primary"
              icon={primaryAction.icon}
              loading={busy}
              onClick={() => void transition(primaryAction.to)}
            >
              {primaryAction.label}
            </Button>
          )}
          {detail.state === 'in_review' && (
            <a className="btn btn--gold" href="#/review">
              <Icon name="review" size={17} />
              <span>فتح المراجعة</span>
            </a>
          )}
          {detail.assets.some((asset) => asset.status === 'present') &&
            detail.jobs.some((job) => job.resultJson) && (
              <Button variant="danger" icon="close" onClick={() => setTrashOpen(true)}>
                حذف الخام
              </Button>
            )}
          <Button variant="secondary" icon="plus" onClick={() => setJobOpen(true)} disabled={!detail.relPath}>
            وظيفة جديدة
          </Button>
          <a className="btn btn--secondary" href={`#/montage?event=${detail.id}`}>
            <Icon name="film" size={16} />
            <span>مهمة مونتاج</span>
          </a>
        </div>
      </Card>

      <div className="split">
        <Card>
          <SectionHeader
            title="الأصول"
            description="الملفات الأصلية داخل المكتب، مع بصمة التحقق."
          />
          {detail.assets.length > 0 ? (
            <div className="asset-list">
              {detail.assets.map((asset) => (
                <div className="asset" key={asset.id}>
                  <div className="asset__icon">
                    <Icon name={asset.kind === 'image' ? 'library' : asset.kind === 'audio' ? 'activity' : 'film'} size={18} />
                  </div>
                  <div className="asset__body">
                    <strong dir="ltr">{asset.relPath.split('/').pop()}</strong>
                    <span className="muted tiny">
                      {formatBytes(asset.bytes)} · {shortHash(asset.sha256)} · {asset.kind}
                    </span>
                  </div>
                  {(asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image') && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="معاينة"
                      onClick={() =>
                        setPlayer({
                          url: `/api/assets/${asset.id}/file`,
                          kind: asset.kind,
                          title: asset.relPath,
                        })
                      }
                    >
                      <Icon name="play" size={17} />
                    </button>
                  )}
                  {asset.status === 'present' && (
                    <div className="asset__actions">
                      <button type="button" className="link small" onClick={() => openRelocate(asset)}>
                        نقل
                      </button>
                      <button type="button" className="link small" onClick={() => void undoMove(asset)}>
                        إرجاع
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              title="لا أصول بعد"
              description="افرّغ بطاقة لهذا الحدث أو استخدم حدثًا موجودًا."
            />
          )}
        </Card>

        <Card>
          <SectionHeader
            title="الوظائف"
            description="من الطابور إلى المراجعة إلى النشر."
            action={
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setJobOpen(true)} disabled={!detail.relPath}>
                إضافة
              </Button>
            }
          />
          {detail.jobs.length > 0 ? (
            <div className="job-list">
              {detail.jobs.map((job) => (
                <div className="job" key={job.id}>
                  <div className="job__head">
                    <div>
                      <strong>{jobKindLabel(job.kind)}</strong>
                      <span className="muted tiny">
                        {job.styleName ?? 'بلا أسلوب'} · {job.mode === 'auto' ? 'تلقائي' : 'يدوي'}
                      </span>
                    </div>
                    <JobStatus state={job.state} />
                  </div>
                  {job.state === 'running' && <Progress value={job.progress} />}
                  {job.step && <span className="muted tiny">{job.step}</span>}
                  {job.errorMessage && <p className="form-error small">{job.errorMessage}</p>}
                  <div className="job__actions">
                    {job.state === 'review_pending' && (
                      <a className="link small" href={`#/review/${job.id}`}>
                        مراجعة الآن
                      </a>
                    )}
                    {(job.state === 'approved' || job.state === 'published') && (
                      <a className="link small" href={`#/review/${job.id}`}>
                        تفاصيل النشر
                      </a>
                    )}
                    {(job.state === 'queued' || job.state === 'running') && (
                      <button
                        type="button"
                        className="link small link--danger"
                        onClick={async () => {
                          try {
                            await api(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
                            toast('أُلغيت الوظيفة.', 'success');
                            event.reload();
                          } catch (error) {
                            toast(error instanceof Error ? error.message : 'تعذّر الإلغاء.', 'error');
                          }
                        }}
                      >
                        إلغاء
                      </button>
                    )}
                    {(job.state === 'failed' ||
                      job.state === 'interrupted' ||
                      job.state === 'blocked' ||
                      job.state === 'blocked_offline') && (
                      <button
                        type="button"
                        className="link small"
                        onClick={async () => {
                          try {
                            await api(`/api/jobs/${job.id}/retry`, { method: 'POST' });
                            toast('أُعيدت الوظيفة إلى الطابور.', 'success');
                            event.reload();
                          } catch (error) {
                            toast(error instanceof Error ? error.message : 'تعذّرت الإعادة.', 'error');
                          }
                        }}
                      >
                        إعادة المحاولة
                      </button>
                    )}
                    <span className="muted tiny">{formatDateTime(job.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="film"
              title="لا وظائف بعد"
              description="أنشئ وظيفة مونتاج أو تفريغ لهذا الحدث."
              action={
                <Button size="sm" icon="plus" onClick={() => setJobOpen(true)} disabled={!detail.relPath}>
                  وظيفة جديدة
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <Card>
        <details>
          <summary className="details-summary">
            <span>التفاصيل التقنية</span>
            <span className="muted tiny">المسار، المعرّف، البيان</span>
          </summary>
          <div className="tech-grid">
            <KeyValue label="معرّف الحدث">
              <code dir="ltr">{detail.id}</code>
            </KeyValue>
            <KeyValue label="المسار النسبي">
              <code dir="ltr">{detail.relPath ?? '—'}</code>
            </KeyValue>
            <KeyValue label="المعرّف اللاتيني">
              <code dir="ltr">{detail.slug}</code>
            </KeyValue>
            <KeyValue label="القرص">
              <code dir="ltr">{detail.volumeId ?? '—'}</code>
            </KeyValue>
          </div>
          {detail.manifest && (
            <pre className="manifest" dir="ltr">
              {JSON.stringify(detail.manifest, null, 2)}
            </pre>
          )}
        </details>
      </Card>

      <Modal
        open={jobOpen}
        title="وظيفة جديدة"
        description="الوظيفة تُنفّذ داخل مجلد العمل ولا تلمس المصدر."
        onClose={() => setJobOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setJobOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" onClick={() => void createJob()} loading={busy}>
              إضافة إلى الطابور
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="نوع الوظيفة">
            <Select
              value={jobForm.kind}
              onChange={(event) => setJobForm({ ...jobForm, kind: event.target.value })}
            >
              <option value="edit">مونتاج</option>
              <option value="reel">ريل</option>
              <option value="transcribe">تفريغ نصي</option>
              <option value="thumbnail">غلاف</option>
            </Select>
          </Field>
          <Field label="الأسلوب" hint={enabledStyles.length === 0 ? 'لا توجد حزم أساليب مثبتة.' : undefined}>
            <Select
              value={selectedStyle?.id ?? ''}
              onChange={(event) => setJobForm({ ...jobForm, styleId: event.target.value })}
              disabled={enabledStyles.length === 0}
            >
              {enabledStyles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name} · {style.version}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="التنفيذ">
            <Select
              value={jobForm.mode}
              onChange={(event) => setJobForm({ ...jobForm, mode: event.target.value })}
            >
              <option value="manual">يدوي — ابدأ الآن</option>
              <option value="auto">تلقائي — نافذة ليلية</option>
            </Select>
          </Field>
          <Field label="أقصى مدة (دقيقة)">
            <Input
              type="number"
              min={1}
              max={1440}
              value={jobForm.maxMinutes}
              onChange={(event) => setJobForm({ ...jobForm, maxMinutes: Number(event.target.value) })}
            />
          </Field>
        </div>
        {selectedStyle && (
          <div className="hint-box">
            <strong>{selectedStyle.name}</strong>
            <span className="muted small">{selectedStyle.description}</span>
            <span className="muted tiny">
              الوقت المتوقع {selectedStyle.estMinutes} دقيقة · {selectedStyle.gpu ? 'يحتاج GPU' : 'لا يحتاج GPU'}
            </span>
          </div>
        )}
      </Modal>

      <Modal
        open={player !== null}
        title={player?.title ?? 'معاينة'}
        onClose={() => setPlayer(null)}
        size="lg"
      >
        {player && (
          <MediaPlayer
            url={`${window.workspace?.apiBase ?? ''}${player.url}?token=${encodeURIComponent(window.workspace?.token ?? '')}`}
            kind={player.kind}
            title={player.title}
          />
        )}
      </Modal>

      <Modal
        open={relocateAsset !== null}
        title="نقل الأصل إلى حدث آخر"
        description={`الأصل: ${relocateAsset?.relPath.split('/').pop() ?? ''}`}
        onClose={() => setRelocateAsset(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRelocateAsset(null)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!targetEvent}
              onClick={() => void submitRelocate()}
            >
              تنفيذ النقل
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="الحدث الهدف" span>
            <Select value={targetEvent} onChange={(event) => setTargetEvent(event.target.value)}>
              {(events.data?.items ?? [])
                .filter((item) => item.id !== detail.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.occurredAt}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="الطريقة">
            <Select
              value={relocateMode}
              onChange={(event) => setRelocateMode(event.target.value as 'move' | 'copy')}
            >
              <option value="move">نقل — يختفي من هذا الحدث</option>
              <option value="copy">نسخ — يبقى في الحدثين</option>
            </Select>
          </Field>
        </div>
        <p className="muted small">
          يتم التحقق بالهاش قبل النقل. عند النقل بين قرصين تُحذف النسخة الأصلية فقط بعد التأكد.
        </p>
      </Modal>

      <Modal
        open={trashOpen}
        title="حذف الخام مع الإبقاء على الناتج"
        description="لن يُحذف أي ملف نهائيًا: يُنقل الخام إلى سلة المكتب 30 يومًا، وتبقى المخرجات."
        onClose={() => setTrashOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrashOpen(false)}>
              إلغاء
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void trashSources()}>
              نقل الخام إلى السلة
            </Button>
          </>
        }
      >
        <p className="muted small">
          للتأكيد، اكتب اسم الحدث: <strong>{detail.title}</strong>
        </p>
        <Field label="اسم الحدث" span required>
          <Input value={confirmTitle} onChange={(event) => setConfirmTitle(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
