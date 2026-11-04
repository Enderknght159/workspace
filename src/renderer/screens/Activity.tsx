import type { AuditEntry } from '../../shared/models.js';
import { useApi } from '../lib/hooks';
import { Badge, Card, EmptyState, SectionHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';

const ACTION_LABELS: Record<string, string> = {
  'event.create': 'إنشاء حدث',
  'event.update': 'تعديل حدث',
  'event.transition': 'تغيير حالة حدث',
  'job.create': 'إنشاء وظيفة',
  'job.review.approved': 'اعتماد وظيفة',
  'job.review.revision': 'إعادة وظيفة للتعديل',
  'job.review.rejected': 'رفض وظيفة',
  'job.publish': 'تسجيل نشر',
  'volume.register': 'تسجيل قرص',
  'volume.refresh': 'تحديث قرص',
  'ingest.start': 'بدء تفريغ',
  'settings.update': 'تعديل إعدادات',
  'settings.reset': 'إعادة ضبط إعدادات',
  'security.password_set': 'تعيين كلمة مرور',
  'security.elevated': 'فتح صلاحية',
  'security.lockout': 'قفل المحاولات',
  'office.backup': 'نسخة احتياطية',
  'archive.run': 'تشغيل أرشفة',
};

const ENTITY_LABELS: Record<string, string> = {
  event: 'حدث',
  job: 'وظيفة',
  volume: 'قرص',
  settings: 'إعدادات',
  office: 'مكتب',
};

export function Activity() {
  const audit = useApi<AuditEntry[]>('/api/audit?limit=200');

  return (
    <div className="stack">
      <Card>
        <SectionHeader
          title="سجل النشاط"
          description="من فعل ماذا، ومتى، وهل استخدم صلاحية مرتفعة."
          action={
            <a className="btn btn--ghost btn--sm" href="#/activity" onClick={() => audit.reload()}>
              تحديث
            </a>
          }
        />
        {audit.loading && !audit.data ? (
          <Spinner label="تحميل السجل…" />
        ) : audit.data && audit.data.length > 0 ? (
          <div className="timeline">
            {audit.data.map((entry) => (
              <div className="timeline__item" key={entry.id}>
                <span className={`timeline__dot ${entry.elevated ? 'timeline__dot--elevated' : ''}`} />
                <div className="timeline__body">
                  <div className="timeline__head">
                    <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
                    {entry.elevated && <Badge tone="gold">بصلاحية مرتفعة</Badge>}
                    <span className="muted tiny">{formatDateTime(entry.at)}</span>
                  </div>
                  <span className="muted small">
                    {ENTITY_LABELS[entry.entity] ?? entry.entity} · {entry.entityId.slice(0, 18)} —{' '}
                    {entry.actorId ?? 'النظام'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="activity" title="السجل فارغ" description="ستظهر هنا كل العمليات الحساسة." />
        )}
      </Card>
    </div>
  );
}
