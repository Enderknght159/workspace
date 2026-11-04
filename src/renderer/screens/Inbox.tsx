import { useState } from 'react';
import type { EventKind } from '../../shared/constants.js';
import type { IngestBatch, IngestPreview, VolumeView } from '../../shared/models.js';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import { Badge, Button, Card, EmptyState, Field, Input, Progress, SectionHeader, Select } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatBytes, formatDateTime } from '../lib/format';
import { eventKindLabel } from '../lib/labels';

const KINDS: EventKind[] = ['lesson', 'khutbah', 'event', 'photoshoot', 'other'];

const BLOCK_MESSAGES: Record<string, string> = {
  no_media: 'لا توجد ملفات فيديو أو صور في هذا المجلد.',
  no_hot_volume: 'لا يوجد قرص ساخن مسجّل ومتصل.',
  insufficient_space: 'المساحة الحرة أقل من الحد الأدنى لبدء التفريغ.',
};

const BATCH_LABELS: Record<string, string> = {
  copying: 'نسخ',
  verifying: 'تحقق',
  organizing: 'تنظيم',
  completed: 'مكتملة',
  failed: 'فاشلة',
  cancelled: 'ملغاة',
  previewing: 'معاينة',
};

export function Inbox() {
  const { toast, poke, runElevated } = useApp();
  const volumes = useApi<VolumeView[]>('/api/volumes');
  const batches = useApi<IngestBatch[]>('/api/ingest/batches');
  const [source, setSource] = useState('');
  const [kind, setKind] = useState<EventKind>('lesson');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slug, setSlug] = useState('');
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);

  const hot = volumes.data?.find((volume) => volume.kind === 'hot');
  const request = {
    source,
    kind,
    occurredAt: date,
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(slug.trim() ? { slug: slug.trim() } : {}),
  };

  async function chooseFolder() {
    const folder = await window.workspace?.chooseDirectory();
    if (!folder) return;
    setSource(folder);
    setPreview(null);
  }

  async function runPreview() {
    if (!source) {
      toast('اختر مجلد البطاقة أولًا.', 'error');
      return;
    }
    setPreviewing(true);
    try {
      const result = await api<IngestPreview>('/api/ingest/preview', {
        method: 'POST',
        body: request,
      });
      setPreview(result);
      if (!title.trim()) setTitle(result.suggested.title);
      if (!slug.trim()) setSlug(result.suggested.slug);
      setKind(result.suggested.kind);
      setDate(result.suggested.occurredAt);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّرت المعاينة.', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function startIngest() {
    if (!preview || preview.blocked) return;
    setStarting(true);
    try {
      const batch = await api<IngestBatch>('/api/ingest/start', {
        method: 'POST',
        body: request,
      });
      toast(`بدأت الدفعة ${batch.sourceLabel}. يمكنك متابعة العمل داخل التطبيق.`, 'success');
      setPreview(null);
      poke();
      volumes.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر بدء التفريغ.', 'error');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="stack">
      <div className="two-col two-col--wide">
        <Card>
          <SectionHeader
            title="تفريغ بطاقة"
            description="انسخ من البطاقة، تحقّق بالهاش، ثم نظّم داخل المكتب. لن يُحذف شيء من المصدر."
          />
          {!hot && (
            <div className="alert-inline">
              <Icon name="alert" size={18} />
              <span>
                لا يوجد قرص ساخن متصل. سجّل قرصًا من <a href="#/settings">الإعدادات</a> أولًا.
              </span>
            </div>
          )}

          <div className="form-grid">
            <Field label="مجلد المصدر" span required>
              <div className="input-row">
                <Input
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="E:\DCIM\100CANON"
                  dir="ltr"
                />
                <Button icon="folder" onClick={() => void chooseFolder()}>
                  اختيار
                </Button>
              </div>
            </Field>

            <Field label="نوع الحدث">
              <Select value={kind} onChange={(event) => setKind(event.target.value as EventKind)}>
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {eventKindLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="التاريخ">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>

            <Field label="العنوان العربي" span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثال: درس بر الوالدين"
              />
            </Field>

            <Field
              label="معرّف المجلد (ASCII)"
              hint="أحرف لاتينية صغيرة وأرقام وشرطات. يُستخدم في المسار فقط."
            >
              <Input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="abu-bakr"
                dir="ltr"
              />
            </Field>
          </div>

          <div className="form-actions">
            <Button icon="scan" onClick={() => void runPreview()} loading={previewing} disabled={!source}>
              معاينة
            </Button>
            <Button
              variant="gold"
              icon="inbox"
              onClick={() => void startIngest()}
              loading={starting}
              disabled={!preview || preview.blocked}
            >
              بدء التفريغ
            </Button>
          </div>

          {preview && (
            <div className="preview">
              <div className="preview__stats">
                <div>
                  <span className="eyebrow">الملفات</span>
                  <strong>{preview.totalFiles}</strong>
                </div>
                <div>
                  <span className="eyebrow">الحجم</span>
                  <strong>{formatBytes(preview.totalBytes)}</strong>
                </div>
                <div>
                  <span className="eyebrow">الوجهة</span>
                  <strong>{preview.suggested.slug}</strong>
                </div>
                <div>
                  <span className="eyebrow">الحرة</span>
                  <strong>{formatBytes(preview.freeBytes)}</strong>
                </div>
              </div>

              {preview.blocked && (
                <div className="alert-inline alert-inline--danger">
                  <Icon name="alert" size={18} />
                  <span>{BLOCK_MESSAGES[preview.blockReason ?? ''] ?? 'لا يمكن بدء التفريغ.'}</span>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <ul className="warn-list">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <div className="file-list">
                {preview.files.slice(0, 12).map((file) => (
                  <div className="file-row" key={file.relPath}>
                    <Icon name={file.kind === 'image' ? 'library' : 'film'} size={16} />
                    <span className="file-row__name" dir="ltr">
                      {file.relPath}
                    </span>
                    <span className="muted tiny">{formatBytes(file.bytes)}</span>
                  </div>
                ))}
                {preview.files.length > 12 && (
                  <p className="muted tiny">+ {preview.files.length - 12} ملفًا آخر…</p>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="دفعات التفريغ"
            description="آخر عمليات النسخ والتحقق."
            action={
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => batches.reload()}>
                تحديث
              </Button>
            }
          />
          {batches.data && batches.data.length > 0 ? (
            <div className="batch-list">
              {batches.data.map((batch) => {
                const progress = batch.totalFiles === 0 ? 0 : (batch.copiedFiles / batch.totalFiles) * 100;
                const active = ['copying', 'verifying', 'organizing'].includes(batch.state);
                return (
                  <div className="batch" key={batch.id}>
                    <div className="batch__head">
                      <div>
                        <strong dir="auto">{batch.sourceLabel}</strong>
                        <span className="muted tiny">
                          {formatDateTime(batch.startedAt)} · {batch.verifiedFiles}/{batch.totalFiles} متحقق
                        </span>
                      </div>
                      <Badge
                        tone={
                          batch.state === 'completed'
                            ? 'green'
                            : batch.state === 'failed'
                              ? 'red'
                              : batch.state === 'cancelled'
                                ? 'neutral'
                                : 'blue'
                        }
                      >
                        {BATCH_LABELS[batch.state] ?? batch.state}
                      </Badge>
                    </div>
                    <Progress value={progress} tone={batch.state === 'failed' ? 'red' : 'green'} />
                    {batch.error && <p className="form-error small">{batch.error}</p>}
                    {active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void runElevated(() =>
                            api(`/api/ingest/${batch.id}/cancel`, { method: 'POST' }),
                          )
                        }
                      >
                        إلغاء
                      </Button>
                    )}
                    {batch.eventId && (
                      <a className="link small" href={`#/events/${batch.eventId}`}>
                        فتح الحدث
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              title="لا توجد دفعات بعد"
              description="اختر مجلد البطاقة ثم عاين قبل البدء."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
