import { useEffect, useMemo, useState } from 'react';
import type {
  EditTask,
  EditTaskDetail,
  EditTaskKind,
  EditTaskState,
  EventDetail as EventDetailModel,
  EventSummary,
  Page,
  User,
} from '../../shared/models.js';
import { api, getActorId } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  SectionHeader,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { formatBytes, formatDateTime } from '../lib/format';
import type { Tone } from '../lib/labels';

const KIND_LABELS: Record<EditTaskKind, string> = {
  full: 'مونتاج كامل',
  reel: 'ريل',
  khutbah: 'خطبة',
};

const STATE_LABELS: Record<EditTaskState, string> = {
  planned: 'بانتظار إنشاء المشروع',
  project_ready: 'المشروع جاهز',
  editing: 'قيد المونتاج',
  exported: 'تم التصدير',
  review: 'للمراجعة',
  approved: 'معتمد',
  archived: 'مؤرشف',
  cancelled: 'ملغى',
};

const STATE_TONES: Record<EditTaskState, Tone> = {
  planned: 'neutral',
  project_ready: 'blue',
  editing: 'gold',
  exported: 'violet',
  review: 'gold',
  approved: 'green',
  archived: 'neutral',
  cancelled: 'red',
};

export function EditTasks({ initialEventId }: { initialEventId: string | null }) {
  const { toast, poke, runElevated } = useApp();
  const tasks = useApi<EditTask[]>('/api/edit-tasks');
  const events = useApi<Page<EventSummary>>('/api/events?limit=200&offset=0');
  const users = useApi<User[]>('/api/users');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState(initialEventId ?? '');
  const [taskKind, setTaskKind] = useState<EditTaskKind>('full');
  const [taskTitle, setTaskTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());

  const selectedEvent = useApi<EventDetailModel>(eventId ? `/api/events/${eventId}` : null);
  const detail = useApi<EditTaskDetail>(selectedId ? `/api/edit-tasks/${selectedId}` : null);

  useEffect(() => {
    if (!selectedId && tasks.data && tasks.data.length > 0) {
      setSelectedId(initialEventId
        ? tasks.data.find((task) => task.eventId === initialEventId)?.id ?? tasks.data[0]!.id
        : tasks.data[0]!.id);
    }
  }, [tasks.data, selectedId, initialEventId]);

  useEffect(() => {
    if (!selectedEvent.data) return;
    const videos = selectedEvent.data.assets.filter(
      (asset) => asset.kind === 'video' && asset.status === 'present',
    );
    setSelectedAssets(new Set(videos.map((asset) => asset.id)));
    if (!taskTitle) setTaskTitle(selectedEvent.data.title);
  }, [selectedEvent.data]);

  const author = useMemo(
    () => users.data?.find((user) => user.id === getActorId()) ?? null,
    [users.data],
  );

  async function createTask() {
    if (!eventId) {
      toast('اختر الحدث أولًا.', 'error');
      return;
    }
    if (selectedAssets.size === 0) {
      toast('اختر مصدرًا واحدًا على الأقل.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api<EditTaskDetail>('/api/edit-tasks', {
        method: 'POST',
        body: {
          eventId,
          kind: taskKind,
          title: taskTitle.trim() || undefined,
          notes: notes.trim() || undefined,
          assetIds: [...selectedAssets],
        },
      });
      toast('جُهّزت مهمة المونتاج. سينشئ Premiere المشروع تلقائيًا.', 'success');
      setCreateOpen(false);
      setSelectedId(created.id);
      setTaskTitle('');
      setNotes('');
      tasks.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر إنشاء مهمة المونتاج.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setState(task: EditTask, state: EditTaskState) {
    setBusy(true);
    try {
      await api(`/api/edit-tasks/${task.id}`, {
        method: 'PATCH',
        body: { state },
        actorId: getActorId(),
      });
      toast(`الحالة: ${STATE_LABELS[state]}`, 'success');
      detail.reload();
      tasks.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تحديث الحالة.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function registerExport(task: EditTask) {
    const file = await window.workspace?.chooseFile();
    if (!file) return;
    setBusy(true);
    try {
      const updated = await api<EditTaskDetail>(`/api/edit-tasks/${task.id}/export`, {
        method: 'POST',
        body: { path: file },
      });
      detail.reload();
      tasks.reload();
      toast(
        updated.externalOutputPath
          ? 'سُجّل الملف، لكنه خارج مجلد المكتب. انقله إلى المكتب عند الإمكان.'
          : 'سُجّل ملف التصدير داخل المكتب.',
        updated.externalOutputPath ? 'info' : 'success',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تسجيل التصدير.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openProject(task: EditTaskDetail) {
    if (!task.projectPath) return;
    const result = await window.workspace?.openPath(task.projectPath);
    if (result) {
      toast('لم يُعثر على المشروع بعد. شغّل سكربت الإنشاء من Premiere أو افتح لوحة Workspace Bridge.', 'error');
    }
  }

  function copyScript(path: string | null) {
    if (!path) return;
    void navigator.clipboard.writeText(path).then(() => toast('نُسخ مسار السكربت.', 'success'));
  }

  return (
    <div className="stack">
      <Card>
        <SectionHeader
          title="مهام المونتاج"
          description="مشاريع Premiere حقيقية داخل مجلد الحدث، مرتبطة بالمصادر ومجلد التصدير."
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
              مهمة مونتاج جديدة
            </Button>
          }
        />
        {tasks.data && tasks.data.length > 0 ? (
          <div className="edit-task-list">
            {tasks.data.map((task) => (
              <button
                type="button"
                key={task.id}
                className={`edit-task-row ${selectedId === task.id ? 'is-active' : ''}`}
                onClick={() => setSelectedId(task.id)}
              >
                <div className="edit-task-row__icon">
                  <Icon name="film" size={18} />
                </div>
                <div className="edit-task-row__body">
                  <strong>{task.title}</strong>
                  <span className="muted tiny">
                    {task.eventTitle} · {KIND_LABELS[task.kind]} · {formatDateTime(task.createdAt)}
                  </span>
                </div>
                <Badge tone={STATE_TONES[task.state]}>{STATE_LABELS[task.state]}</Badge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="film"
            title="لا مهام مونتاج بعد"
            description="أنشئ مهمة من هنا أو من صفحة الحدث. سيُنشئ الجسر مشروع Premiere في مجلد الحدث."
          />
        )}
      </Card>

      {detail.data ? (
        <div className="split">
          <Card>
            <SectionHeader
              title={detail.data.title}
              description={`${detail.data.eventTitle} · ${KIND_LABELS[detail.data.kind]}`}
              action={<Badge tone={STATE_TONES[detail.data.state]}>{STATE_LABELS[detail.data.state]}</Badge>}
            />
            <div className="edit-detail-actions">
              <Button
                variant="primary"
                icon="external"
                onClick={() => void openProject(detail.data!)}
                disabled={!detail.data.projectPath}
              >
                فتح مشروع Premiere
              </Button>
              <Button
                icon="folder"
                onClick={() =>
                  void window.workspace?.openPath(detail.data!.outputPath ?? '')
                }
                disabled={!detail.data.outputPath}
              >
                مجلد التصدير
              </Button>
              <Button
                icon="download"
                onClick={() => void registerExport(detail.data!)}
                loading={busy}
              >
                تسجيل ملف التصدير
              </Button>
            </div>

            <div className="tech-grid">
              <div className="kv">
                <span className="kv__label">Sequence</span>
                <span className="kv__value" dir="auto">{detail.data.sequenceName ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="kv__label">المصادر</span>
                <span className="kv__value">{detail.data.sources.length} ملف</span>
              </div>
              <div className="kv">
                <span className="kv__label">المنفّذ</span>
                <span className="kv__value">
                  {users.data?.find((user) => user.id === detail.data!.createdBy)?.name ?? '—'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__label">الملف المصدَّر</span>
                <span className="kv__value">
                  {detail.data.exportedFileRel
                    ? detail.data.exportedFileRel.split('/').pop()
                    : detail.data.externalOutputPath
                      ? 'خارج المكتب'
                      : '—'}
                </span>
              </div>
            </div>

            {detail.data.externalOutputPath && (
              <div className="alert-inline">
                <Icon name="alert" size={18} />
                <span dir="ltr">{detail.data.externalOutputPath}</span>
              </div>
            )}

            {detail.data.state === 'planned' && (
              <div className="hint-box">
                <strong>لم يُنشأ المشروع بعد</strong>
                <span className="muted small">
                  أنشئه الآن عبر Premiere، أو استخدم لوحة Workspace Bridge ليعمل تلقائيًا.
                </span>
                <div className="row gap">
                  <Button
                    size="sm"
                    variant="primary"
                    icon="external"
                    onClick={async () => {
                      const result = await window.workspace?.createPremiereProject(
                        detail.data!.scriptPath ?? '',
                      );
                      if (result?.ok) {
                        toast('بدأ Premiere بإنشاء المشروع. ستتحدث الحالة تلقائيًا.', 'success');
                        window.setTimeout(() => detail.reload(), 8000);
                      } else {
                        toast(result?.message ?? 'تعذّر تشغيل Premiere.', 'error');
                      }
                    }}
                    disabled={!detail.data.scriptPath}
                  >
                    إنشاء المشروع الآن
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copyScript(detail.data!.scriptPath)}>
                    نسخ مسار السكربت
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.workspace?.openPath(detail.data!.scriptPath ?? '')}
                    disabled={!detail.data.scriptPath}
                  >
                    فتح السكربت
                  </Button>
                </div>
              </div>
            )}

            <div className="edit-detail-actions">
              <Button size="sm" onClick={() => void setState(detail.data!, 'editing')} disabled={detail.data.state !== 'project_ready'}>
                بدأ المونتاج
              </Button>
              <Button size="sm" onClick={() => void setState(detail.data!, 'review')} disabled={detail.data.state !== 'editing' && detail.data.state !== 'exported'}>
                إرسال للمراجعة
              </Button>
              <Button size="sm" onClick={() => void setState(detail.data!, 'approved')} disabled={detail.data.state !== 'review'}>
                اعتماد
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void setState(detail.data!, 'archived')} disabled={detail.data.state === 'archived'}>
                أرشفة
              </Button>
            </div>

            <p className="muted tiny">
              كل تغيير حالة يُسجّل باسم {author?.name ?? 'المستخدم الحالي'}.
            </p>
          </Card>

          <Card>
            <SectionHeader title="المصادر" description="مرتبطة بالمشروع وقت الإنشاء." />
            <div className="asset-list">
              {detail.data.sources.map((source) => (
                <div className="asset" key={source.assetId}>
                  <div className="asset__icon">
                    <Icon name="film" size={17} />
                  </div>
                  <div className="asset__body">
                    <strong dir="ltr">{source.relPath.split('/').pop()}</strong>
                    <span className="muted tiny">
                      {formatBytes(source.bytes)} · {source.kind}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="tech-grid">
              <div className="kv">
                <span className="kv__label">ملف المهمة</span>
                <span className="kv__value tiny" dir="ltr">
                  {detail.data.jobFilePath ?? '—'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__label">مجلد الترجمة</span>
                <span className="kv__value tiny" dir="ltr">
                  {detail.data.subtitlePath ?? '—'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      ) : selectedId && detail.loading ? (
        <Card>
          <Spinner label="تحميل المهمة…" />
        </Card>
      ) : (
        <Card>
          <EmptyState icon="film" title="اختر مهمة" description="ستظهر هنا تفاصيل المشروع والتصدير." />
        </Card>
      )}

      <Modal
        open={createOpen}
        title="مهمة مونتاج جديدة"
        description="يُنشأ مجلد مشروع مستقل داخل الحدث، مع مصادر ومجلد تصدير وترجمة."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void createTask()}>
              إنشاء المهمة
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="الحدث" span required>
            <Select value={eventId} onChange={(event) => setEventId(event.target.value)}>
              <option value="">اختر حدثًا…</option>
              {(events.data?.items ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} · {event.occurredAt}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="النوع">
            <Select value={taskKind} onChange={(event) => setTaskKind(event.target.value as EditTaskKind)}>
              <option value="full">مونتاج كامل</option>
              <option value="reel">ريل 9:16</option>
              <option value="khutbah">خطبة</option>
            </Select>
          </Field>
          <Field label="العنوان">
            <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
          </Field>
          <Field label="المصادر" span>
            {selectedEvent.data ? (
              <div className="file-list file-list--select">
                {selectedEvent.data.assets
                  .filter((asset) => asset.kind === 'video' && asset.status === 'present')
                  .map((asset) => (
                    <label className="file-row file-row--select" key={asset.id}>
                      <input
                        type="checkbox"
                        checked={selectedAssets.has(asset.id)}
                        onChange={() => {
                          setSelectedAssets((current) => {
                            const next = new Set(current);
                            if (next.has(asset.id)) next.delete(asset.id);
                            else next.add(asset.id);
                            return next;
                          });
                        }}
                      />
                      <span className="file-row__name" dir="ltr">
                        {asset.relPath.split('/').pop()}
                      </span>
                      <span className="muted tiny">{formatBytes(asset.bytes)}</span>
                    </label>
                  ))}
                {selectedEvent.data.assets.filter((asset) => asset.kind === 'video').length === 0 && (
                  <p className="muted small">لا توجد ملفات فيديو في هذا الحدث.</p>
                )}
              </div>
            ) : (
              <span className="muted small">اختر حدثًا لعرض مصادره.</span>
            )}
          </Field>
          <Field label="ملاحظات" span>
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
