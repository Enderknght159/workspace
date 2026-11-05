import { useEffect, useMemo, useState } from 'react';
import type { JobDetail, JobSummary, User } from '../../shared/models.js';
import { api, mediaUrl, getActorId } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Progress,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { JobStatus } from '../components/StatusBadge';
import { MediaPlayer } from '../components/MediaPlayer';
import { formatDateTime, relativeTime } from '../lib/format';
import { jobKindLabel } from '../lib/labels';

const PLATFORMS = [
  ['youtube', 'YouTube'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['whatsapp', 'WhatsApp'],
];

interface ResultExtras {
  warnings?: string[];
  needs_review?: string[];
}

export function Review({ initialJobId }: { initialJobId: string | null }) {
  const { toast, poke, runElevated } = useApp();
  const pending = useApi<JobSummary[]>('/api/review/pending');
  const users = useApi<User[]>('/api/users');
  const [selected, setSelected] = useState<string | null>(initialJobId);
  const [reviewActor, setReviewActor] = useState(getActorId());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [platform, setPlatform] = useState('youtube');

  useEffect(() => {
    if (!selected && pending.data && pending.data.length > 0) {
      setSelected(pending.data[0]!.id);
    }
  }, [pending.data, selected]);

  const detail = useApi<JobDetail>(selected ? `/api/jobs/${selected}` : null);

  useEffect(() => {
    setChecks({});
    setNotes('');
    setPublishUrl('');
  }, [selected]);

  const extras = useMemo<ResultExtras>(() => {
    if (!detail.data?.resultJson) return {};
    try {
      return JSON.parse(detail.data.resultJson) as ResultExtras;
    } catch {
      return {};
    }
  }, [detail.data?.resultJson]);

  const output = detail.data?.outputs.find((item) => /\.(mp4|mov|webm)$/i.test(item.path));
  const required = detail.data?.checklist.filter((item) => item.required) ?? [];
  const requiredMissing = required.filter((item) => checks[item.id] !== true);
  const canApprove = requiredMissing.length === 0 && detail.data?.state === 'review_pending';

  async function decide(decision: 'approved' | 'revision' | 'rejected') {
    if (!detail.data) return;
    if (decision !== 'approved' && notes.trim().length < 3) {
      toast('اكتب سبب الإعادة أو الرفض أولًا.', 'error');
      return;
    }
    setBusy(true);
    try {
      await runElevated(() =>
        api(`/api/jobs/${detail.data!.id}/review`, {
          method: 'POST',
          body: { decision, checklist: checks, notes: notes.trim() || undefined },
          actorId: reviewActor,
        }),
      );
      toast(
        decision === 'approved'
          ? 'اعتُمدت الوظيفة. يمكنك تسجيل النشر الآن.'
          : decision === 'revision'
            ? 'أُعيدت الوظيفة، وأُنشئت وظيفة مراجعة جديدة.'
            : 'رُفضت الوظيفة نهائيًا.',
        'success',
      );
      detail.reload();
      pending.reload();
      poke();
      if (decision !== 'approved') setSelected(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تسجيل القرار.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!detail.data) return;
    if (!publishUrl.trim()) {
      toast('ألصق رابط المنشور أولًا.', 'error');
      return;
    }
    setBusy(true);
    try {
      await runElevated(() =>
        api(`/api/jobs/${detail.data!.id}/publish`, {
          method: 'POST',
          body: { platform, url: publishUrl.trim() },
          actorId: reviewActor,
        }),
      );
      toast('سُجّل النشر. أصبح الحدث منشورًا.', 'success');
      detail.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تسجيل النشر.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-layout">
      <Card className="review-list">
        <SectionHeader title="بانتظار المراجعة" description={`${pending.data?.length ?? 0} وظيفة`} />
        {pending.data && pending.data.length > 0 ? (
          <div className="review-items">
            {pending.data.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`review-item ${selected === job.id ? 'is-active' : ''}`}
                onClick={() => setSelected(job.id)}
              >
                <div className="review-item__top">
                  <strong>{job.eventTitle}</strong>
                  <JobStatus state={job.state} />
                </div>
                <span className="muted tiny">
                  {jobKindLabel(job.kind)} · {job.styleName ?? 'بلا أسلوب'} · {relativeTime(job.updatedAt)}
                </span>
                <Progress value={job.progress} tone="gold" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="check"
            title="لا شيء للمراجعة"
            description="كل المخرجات تمت مراجعتها أو لم تبدأ بعد."
          />
        )}
      </Card>

      {selected && detail.data ? (
        <div className="review-main">
          <Card>
            <div className="review-head">
              <div>
                <span className="eyebrow">{jobKindLabel(detail.data.kind)}</span>
                <h2>{detail.data.eventTitle}</h2>
                <p className="muted small">
                  الأسلوب {detail.data.styleName ?? '—'} · {detail.data.styleVersion ?? '—'} ·{' '}
                  {formatDateTime(detail.data.updatedAt)}
                </p>
              </div>
              <JobStatus state={detail.data.state} />
            </div>

            {output ? (
              <MediaPlayer
                url={mediaUrl(`/api/jobs/${detail.data.id}/files/${encodeURIComponent(output.path)}`)}
                kind="video"
                title={output.path}
              />
            ) : (
              <div className="media media--empty">
                <Icon name="film" size={22} />
                <div>
                  <strong>لا مخرَج فيديو للمعاينة</strong>
                  <p className="muted small">
                    قد تكون وظيفة تفريغ أو غلافًا، أو أن الوكيل لم ينتج ملفًا بعد.
                  </p>
                </div>
              </div>
            )}

            {(extras.warnings?.length || extras.needs_review?.length) && (
              <div className="review-notes">
                {extras.warnings?.map((warning) => (
                  <p key={warning} className="warn-line">
                    <Icon name="alert" size={15} /> {warning}
                  </p>
                ))}
                {extras.needs_review?.map((item) => (
                  <p key={item} className="warn-line">
                    <Icon name="review" size={15} /> يحتاج مراجعة: {item}
                  </p>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeader
              title="قائمة التحقق"
              description="الاعتماد يتطلب كل البنود الإلزامية. القرار يُسجَّل باسمك."
            />
            <div className="checklist">
              {detail.data.checklist.length > 0 ? (
                detail.data.checklist.map((item) => (
                  <label className="check" key={item.id}>
                    <input
                      type="checkbox"
                      checked={checks[item.id] === true}
                      onChange={(event) =>
                        setChecks((current) => ({ ...current, [item.id]: event.target.checked }))
                      }
                    />
                    <span>{item.label}</span>
                    {item.required && <span className="check__required">إلزامي</span>}
                  </label>
                ))
              ) : (
                <p className="muted small">هذا الأسلوب لا يعرّف قائمة تحقق.</p>
              )}
            </div>

            <Field label="ملاحظات المراجعة" hint="مطلوبة عند الإعادة أو الرفض.">
              <Textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="ما الذي يحتاج تعديلًا؟ كن محددًا."
              />
            </Field>

            <Field label="تنفيذ القرار باسم" hint="افتراضيًا المستخدم الحالي أعلى الشاشة.">
              <Select value={reviewActor} onChange={(event) => setReviewActor(event.target.value)}>
                {(users.data ?? [])
                  .filter((user) => user.active)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <div className="review-actions">
              <Button
                variant="primary"
                icon="check"
                disabled={!canApprove}
                loading={busy}
                onClick={() => void decide('approved')}
              >
                اعتماد
              </Button>
              <Button
                variant="secondary"
                icon="refresh"
                disabled={detail.data.state !== 'review_pending'}
                loading={busy}
                onClick={() => void decide('revision')}
              >
                إعادة للتعديل
              </Button>
              <Button
                variant="danger"
                icon="close"
                disabled={detail.data.state !== 'review_pending'}
                loading={busy}
                onClick={() => void decide('rejected')}
              >
                رفض نهائي
              </Button>
            </div>
            {!canApprove && detail.data.state === 'review_pending' && (
              <p className="muted tiny">
                {requiredMissing.length > 0
                  ? `${requiredMissing.length} بند إلزامي لم يُؤكد بعد.`
                  : 'لا يمكن الاعتماد في هذه الحالة.'}
              </p>
            )}
          </Card>

          {detail.data.state === 'approved' && (
            <Card className="publish-card">
              <SectionHeader title="تسجيل النشر" description="انشر من المنصة ثم ألصق الرابط هنا. لا نشر تلقائي." />
              <div className="form-grid">
                <Field label="المنصة">
                  <Select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                    {PLATFORMS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="رابط المنشور" span>
                  <Input
                    dir="ltr"
                    value={publishUrl}
                    onChange={(event) => setPublishUrl(event.target.value)}
                    placeholder="https://…"
                  />
                </Field>
              </div>
              <Button variant="gold" icon="external" loading={busy} onClick={() => void publish()}>
                تسجيل النشر
              </Button>
            </Card>
          )}

          {detail.data.publication && (
            <Card>
              <SectionHeader title="النشر" description="سُجّل هذا المنشور." />
              <p className="muted small">
                {detail.data.publication.platform} · {formatDateTime(detail.data.publication.publishedAt)}
              </p>
              <a className="link" href={detail.data.publication.url} target="_blank" rel="noreferrer" dir="ltr">
                {detail.data.publication.url}
              </a>
            </Card>
          )}
        </div>
      ) : selected && detail.loading ? (
        <Card>
          <Spinner label="تحميل الوظيفة…" />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="review"
            title="اختر وظيفة للمراجعة"
            description="ستظهر هنا المخرجات وقائمة التحقق والقرارات."
          />
        </Card>
      )}
    </div>
  );
}
