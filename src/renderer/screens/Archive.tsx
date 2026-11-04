import { useEffect, useState } from 'react';
import type { ArchiveCandidate, ArchiveReport, VolumeView } from '../../shared/models.js';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import { Badge, Button, Card, EmptyState, Field, SectionHeader, Select, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatBytes, formatDate } from '../lib/format';

export function Archive() {
  const { toast, runElevated, poke } = useApp();
  const candidates = useApi<ArchiveCandidate[]>('/api/archive/candidates');
  const volumes = useApi<VolumeView[]>('/api/volumes');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ArchiveReport | null>(null);
  const coldVolumes = volumes.data?.filter((volume) => volume.kind === 'cold') ?? [];
  const connectedCold = coldVolumes.filter((volume) => volume.status === 'connected' && volume.root);

  useEffect(() => {
    if (!target && connectedCold[0]) setTarget(connectedCold[0].id);
  }, [connectedCold, target]);

  async function run(dryRun: boolean) {
    if (!target) {
      toast('اختر قرص الأرشفة أولًا.', 'error');
      return;
    }
    setBusy(true);
    setReport(null);
    try {
      const result = await runElevated(() =>
        api<ArchiveReport>('/api/archive/run', {
          method: 'POST',
          body: {
            targetVolumeId: target,
            dryRun,
            eventIds: candidates.data?.map((candidate) => candidate.eventId),
          },
        }),
      );
      setReport(result);
      toast(
        dryRun
          ? `معاينة: ${result.copied} حدثًا جاهزًا للأرشفة.`
          : `اكتملت الأرشفة: ${result.copied} حدثًا، وفشل ${result.failed}.`,
        result.failed > 0 ? 'error' : 'success',
      );
      candidates.reload();
      volumes.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّرت الأرشفة.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <SectionHeader
          title="الأرشيف والهارد البارد"
          description="نسخ، تحقق بالهاش، كتالوج، ثم نقل المصدر إلى سلة 30 يومًا. لا حذف تلقائي."
        />
        {connectedCold.length === 0 ? (
          <div className="alert-inline">
            <Icon name="disk" size={18} />
            <span>
              لا يوجد قرص بارد متصل. سجّل قرصًا بنوع «بارد» من <a href="#/settings">الإعدادات</a>.
            </span>
          </div>
        ) : (
          <div className="toolbar">
            <Field label="قرص الأرشفة">
              <Select value={target} onChange={(event) => setTarget(event.target.value)}>
                {coldVolumes.map((volume) => (
                  <option key={volume.id} value={volume.id} disabled={volume.status !== 'connected'}>
                    {volume.label} — {volume.status === 'connected' ? 'متصل' : 'غير موصول'}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="row gap">
              <Button
                icon="scan"
                onClick={() => void run(true)}
                loading={busy}
                disabled={!target || (candidates.data?.length ?? 0) === 0}
              >
                معاينة
              </Button>
              <Button
                variant="gold"
                icon="archive"
                onClick={() => void run(false)}
                loading={busy}
                disabled={!target || (candidates.data?.length ?? 0) === 0}
              >
                أرشفة الآن
              </Button>
            </div>
          </div>
        )}
      </Card>

      {report && (
        <Card className={report.failed > 0 ? 'alert-card' : ''}>
          <SectionHeader
            title={report.dryRun ? 'نتيجة المعاينة' : 'نتيجة الأرشفة'}
            description={`${report.copied} ناجح · ${report.failed} فاشل · ${formatBytes(report.bytes)}`}
          />
          <div className="table">
            <div className="table__head">
              <span>الحدث</span>
              <span>الحالة</span>
              <span>الأصول</span>
              <span>الحجم</span>
              <span>ملاحظة</span>
            </div>
            {report.items.map((item) => (
              <div className="table__row" key={item.eventId}>
                <span>{item.title}</span>
                <Badge tone={item.status === 'copied' ? 'green' : item.status === 'failed' ? 'red' : 'neutral'}>
                  {item.status === 'copied' ? 'جاهز/منسوخ' : item.status === 'failed' ? 'فشل' : 'تخطّي'}
                </Badge>
                <span>{item.assets}</span>
                <span>{formatBytes(item.bytes)}</span>
                <span className="muted tiny">{item.error ?? '—'}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader
          title="مرشحات الأرشفة"
          description="أحداث منشورة مضى عليها 7 أيام بلا وظائف مفتوحة."
          action={
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => candidates.reload()}>
              تحديث
            </Button>
          }
        />
        {candidates.loading && !candidates.data ? (
          <Spinner label="تحميل المرشحات…" />
        ) : candidates.data && candidates.data.length > 0 ? (
          <div className="table">
            <div className="table__head">
              <span>الحدث</span>
              <span>نُشر</span>
              <span>الأصول</span>
              <span>الحجم</span>
              <span>الحالة</span>
            </div>
            {candidates.data.map((candidate) => (
              <div className="table__row" key={candidate.eventId}>
                <a className="link" href={`#/events/${candidate.eventId}`}>
                  {candidate.title}
                </a>
                <span>{candidate.publishedAt ? formatDate(candidate.publishedAt) : '—'}</span>
                <span>{candidate.assetCount}</span>
                <span>{formatBytes(candidate.bytes)}</span>
                <Badge tone="gold">جاهز</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="archive"
            title="لا مرشحات الآن"
            description="الأرشفة تبدأ بعد سبعة أيام من النشر وبعد إغلاق كل الوظائف."
          />
        )}
      </Card>
    </div>
  );
}
