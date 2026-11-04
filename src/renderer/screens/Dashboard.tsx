import type {
  DoctorReport,
  EngineInfo,
  EventSummary,
  IngestBatch,
  JobSummary,
  Page,
  VolumeView,
} from '../../shared/models.js';
import { useApi } from '../lib/hooks';
import { Card, EmptyState, Progress, SectionHeader, Spinner } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { EventStatus, JobStatus } from '../components/StatusBadge';
import { eventKindLabel } from '../lib/labels';
import { formatBytes, formatDate, relativeTime } from '../lib/format';

function Stat({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone: 'green' | 'gold' | 'blue' | 'red';
  hint?: string;
}) {
  return (
    <Card className={`stat stat--${tone}`}>
      <div className="stat__icon">
        <Icon name={icon} size={20} />
      </div>
      <div>
        <span className="stat__value">{value}</span>
        <span className="stat__label">{label}</span>
        {hint && <span className="stat__hint">{hint}</span>}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const info = useApi<EngineInfo>('/api/info');
  const review = useApi<JobSummary[]>('/api/review/pending');
  const events = useApi<Page<EventSummary>>('/api/events?limit=6&offset=0');
  const batches = useApi<IngestBatch[]>('/api/ingest/batches');
  const doctor = useApi<DoctorReport | null>('/api/doctor');
  const volumes = useApi<VolumeView[]>('/api/volumes');

  const hot = volumes.data?.find((volume) => volume.kind === 'hot');
  const runningBatch = batches.data?.find((batch) =>
    ['copying', 'verifying', 'organizing'].includes(batch.state),
  );
  const failedTools = doctor.data?.tools.filter((tool) => tool.status === 'fail') ?? [];
  const needsSetup = (volumes.data?.length ?? 0) === 0 || !doctor.data;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero__content">
          <span className="eyebrow">مكتب واحد، حالة واحدة</span>
          <h2>كل المكتب في نافذة واحدة.</h2>
          <p>
            من البطاقة إلى المراجعة إلى الأرشيف. لا تسأل «أين الملف؟» مرة أخرى — كل أصل له مكان وحالة
            ومسؤول.
          </p>
          <div className="hero__actions">
            <a className="btn btn--gold" href="#/inbox">
              <Icon name="inbox" size={17} />
              <span>تفريغ بطاقة</span>
            </a>
            <a className="btn btn--ghost" href="#/library">
              <Icon name="library" size={17} />
              <span>المكتبة</span>
            </a>
          </div>
        </div>
        <div className="hero__panel">
          <div className="hero__metric">
            <span>المساحة الحرة</span>
            <strong>{hot ? formatBytes(hot.freeBytes) : '—'}</strong>
            <span className="muted tiny">{hot?.label ?? 'لا يوجد قرص ساخن'}</span>
          </div>
          <div className="hero__divider" />
          <div className="hero__metric">
            <span>الفحص</span>
            <strong className={doctor.data?.ok ? 'text-green' : doctor.data ? 'text-red' : 'muted'}>
              {doctor.data?.ok ? 'جاهز' : doctor.data ? 'ناقص' : 'لم يُفحص'}
            </strong>
            <span className="muted tiny">
              {doctor.data ? `${doctor.data.tools.filter((tool) => tool.status === 'ok').length} أدوات جاهزة` : 'شغّل الفحص من الإعدادات'}
            </span>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <Stat
          label="قيد التنفيذ"
          value={info.data?.queue.running ?? 0}
          icon="film"
          tone="blue"
          hint={info.data?.queue.running ? 'المعالج مشغول' : 'المعالج خامل'}
        />
        <Stat
          label="في الطابور"
          value={info.data?.queue.queued ?? 0}
          icon="clock"
          tone="gold"
          hint="تُنفّذ تلقائيًا"
        />
        <Stat
          label="بانتظار المراجعة"
          value={review.data?.length ?? 0}
          icon="review"
          tone="green"
          hint="قرار بشري مطلوب"
        />
        <Stat
          label="فشل"
          value={info.data?.queue.failed ?? 0}
          icon="alert"
          tone="red"
          hint="يحتاج انتباهًا"
        />
      </div>

      {needsSetup && (
        <Card className="setup">
          <SectionHeader
            title="أكمل تجهيز المكتب"
            description="ثلاث خطوات تفصل بينك وبين أول تفريغ بطاقة."
          />
          <div className="setup__steps">
            <a href="#/settings" className={`setup__step ${volumes.data?.length ? 'is-done' : ''}`}>
              <span className="setup__num">{volumes.data?.length ? <Icon name="check" size={16} /> : '1'}</span>
              <div>
                <strong>سجّل قرصًا ساخنًا</strong>
                <span>المكان الذي تعيش فيه الملفات وقاعدة البيانات.</span>
              </div>
            </a>
            <a href="#/settings" className={`setup__step ${doctor.data ? 'is-done' : ''}`}>
              <span className="setup__num">{doctor.data ? <Icon name="check" size={16} /> : '2'}</span>
              <div>
                <strong>افحص البيئة</strong>
                <span>FFmpeg وPython وOpenCode وبطاقة الشاشة.</span>
              </div>
            </a>
            <a href="#/inbox" className="setup__step">
              <span className="setup__num">3</span>
              <div>
                <strong>افرّغ أول بطاقة</strong>
                <span>نسخ، تحقق بالهاش، وتسمية عربية واضحة.</span>
              </div>
            </a>
          </div>
        </Card>
      )}

      {failedTools.length > 0 && (
        <Card className="alert-card">
          <div className="alert-card__icon">
            <Icon name="alert" size={20} />
          </div>
          <div>
            <strong>الفحص يحتاج تدخلًا</strong>
            <p className="muted small">
              {failedTools.map((tool) => tool.label).join('، ')} — الوظائف الآلية معطّلة حتى يُصلح.
            </p>
          </div>
          <a href="#/settings" className="btn btn--ghost btn--sm">
            فتح الفحص
          </a>
        </Card>
      )}

      {runningBatch && (
        <Card className="inline-progress">
          <div className="inline-progress__head">
            <div>
              <strong>تفريغ: {runningBatch.sourceLabel}</strong>
              <span className="muted small">
                {runningBatch.copiedFiles} من {runningBatch.totalFiles} ملف
              </span>
            </div>
            <span className="badge badge--blue">
              {runningBatch.state === 'copying' ? 'نسخ' : runningBatch.state === 'verifying' ? 'تحقق' : 'تنظيم'}
            </span>
          </div>
          <Progress
            value={
              runningBatch.totalFiles === 0
                ? 0
                : (runningBatch.copiedFiles / runningBatch.totalFiles) * 100
            }
          />
        </Card>
      )}

      <div className="two-col">
        <Card>
          <SectionHeader
            title="أحدث الأحداث"
            description="آخر ما دخل المكتب."
            action={
              <a className="btn btn--ghost btn--sm" href="#/library">
                عرض الكل
              </a>
            }
          />
          {events.loading && !events.data ? (
            <Spinner label="تحميل الأحداث…" />
          ) : events.data && events.data.items.length > 0 ? (
            <div className="mini-list">
              {events.data.items.map((event) => (
                <a className="mini-row" href={`#/events/${event.id}`} key={event.id}>
                  <div className="mini-row__icon">
                    <Icon name={event.kind === 'photoshoot' ? 'library' : 'film'} size={18} />
                  </div>
                  <div className="mini-row__body">
                    <strong>{event.title}</strong>
                    <span className="muted tiny">
                      {eventKindLabel(event.kind)} · {formatDate(event.occurredAt)} · {event.assetCount} أصل
                    </span>
                  </div>
                  <EventStatus state={event.state} />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              title="المكتب فارغ"
              description="ابدأ بتفريغ بطاقة أو إنشاء حدث يدويًا."
              action={
                <a className="btn btn--primary btn--sm" href="#/inbox">
                  تفريغ بطاقة
                </a>
              }
            />
          )}
        </Card>

        <Card>
          <SectionHeader title="حالة اليوم" description="ملخص سريع لحركة المكتب." />
          <div className="summary-list">
            <div className="summary-row">
              <span>أحداث في المكتب</span>
              <strong>{events.data?.total ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>دفعات تفريغ مكتملة</span>
              <strong>{batches.data?.filter((batch) => batch.state === 'completed').length ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span>وظائف بانتظار المراجعة</span>
              <strong>{review.data?.length ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span>أقراص مسجّلة</span>
              <strong>{volumes.data?.length ?? 0}</strong>
            </div>
          </div>
          {review.data && review.data.length > 0 && (
            <div className="review-peek">
              <span className="eyebrow">الأقرب للمراجعة</span>
              {review.data.slice(0, 2).map((job) => (
                <a className="review-peek__row" href={`#/review/${job.id}`} key={job.id}>
                  <div>
                    <strong>{job.eventTitle}</strong>
                    <span className="muted tiny">{relativeTime(job.updatedAt)}</span>
                  </div>
                  <JobStatus state={job.state} />
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
