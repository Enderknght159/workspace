import { useEffect, useState } from 'react';
import type { DoctorReport, StyleInfo, VolumeView } from '../../shared/models.js';
import type { OfficeSettings } from '../../shared/schemas.js';
import { api, downloadDiagnostics } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  SectionHeader,
  Select,
  Spinner,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { formatBytes, formatDateTime } from '../lib/format';
import { toolTone } from '../lib/labels';

type PublicSettings = Omit<OfficeSettings, 'security'> & {
  security: { hasPassword: boolean; idleLockMinutes: number };
};

interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
}

interface SecurityStatus {
  hasPassword: boolean;
  elevatedUntil: string | null;
  lockedForSeconds: number;
}

type Tab = 'office' | 'storage' | 'environment' | 'workflow' | 'security' | 'data';

const TABS: Array<{ id: Tab; label: string; icon: 'settings' | 'disk' | 'scan' | 'film' | 'shield' | 'archive' }> = [
  { id: 'office', label: 'المكتب', icon: 'settings' },
  { id: 'storage', label: 'التخزين', icon: 'disk' },
  { id: 'environment', label: 'البيئة', icon: 'scan' },
  { id: 'workflow', label: 'سير العمل', icon: 'film' },
  { id: 'security', label: 'الأمان', icon: 'shield' },
  { id: 'data', label: 'البيانات', icon: 'archive' },
];

export function Settings() {
  const { toast, runElevated, poke, theme, setTheme } = useApp();
  const settings = useApi<PublicSettings>('/api/settings');
  const volumes = useApi<VolumeView[]>('/api/volumes');
  const styles = useApi<StyleInfo[]>('/api/styles');
  const doctor = useApi<DoctorReport | null>('/api/doctor');
  const backups = useApi<BackupInfo[]>('/api/backups');
  const security = useApi<SecurityStatus>('/api/security/status');

  const [tab, setTab] = useState<Tab>('office');
  const [form, setForm] = useState<PublicSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [volumeForm, setVolumeForm] = useState({ root: '', label: 'قرص الوسائط', kind: 'hot' as 'hot' | 'cold' });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [startup, setStartup] = useState<boolean | null>(null);

  useEffect(() => {
    void window.workspace
      ?.getStartup()
      .then(setStartup)
      .catch(() => setStartup(false));
  }, []);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  async function save(patch: Record<string, unknown>, message = 'حُفظت الإعدادات.') {
    setBusy(true);
    try {
      await runElevated(() => api('/api/settings', { method: 'PATCH', body: patch }));
      toast(message, 'success');
      settings.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر الحفظ.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function chooseVolumeFolder() {
    const folder = await window.workspace?.chooseDirectory();
    if (folder) setVolumeForm((current) => ({ ...current, root: folder }));
  }

  async function registerVolume() {
    if (!volumeForm.root) {
      toast('اختر مجلد القرص أولًا.', 'error');
      return;
    }
    setBusy(true);
    try {
      await runElevated(() =>
        api('/api/volumes/register', {
          method: 'POST',
          body: volumeForm,
        }),
      );
      toast('سُجّل القرص. يمكنك الآن استخدامه.', 'success');
      setVolumeForm({ root: '', label: 'قرص الوسائط', kind: 'hot' });
      volumes.reload();
      poke();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر تسجيل القرص.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runDoctor(deep: boolean) {
    setBusy(true);
    try {
      await api('/api/doctor/run', { method: 'POST', body: { deep } });
      toast('اكتمل الفحص.', 'success');
      doctor.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر الفحص.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (password.length < 6) {
      toast('كلمة المرور يجب أن تكون 6 أحرف على الأقل.', 'error');
      return;
    }
    if (password !== passwordConfirm) {
      toast('التأكيد لا يطابق كلمة المرور.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await runElevated(() =>
        api<{ recoveryCode: string }>('/api/security/password', {
          method: 'POST',
          body: { password },
        }),
      );
      setPasswordOpen(false);
      setPassword('');
      setPasswordConfirm('');
      setRecoveryCode(result.recoveryCode);
      security.reload();
      settings.reload();
      toast('حُفظت كلمة المرور.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر حفظ كلمة المرور.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function recoverPassword() {
    if (recoveryInput.trim().length < 4) {
      toast('أدخل رمز الاسترداد أولًا.', 'error');
      return;
    }
    if (recoveryPassword.length < 6) {
      toast('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ recoveryCode: string }>('/api/security/recover', {
        method: 'POST',
        body: { recoveryCode: recoveryInput.trim(), password: recoveryPassword },
      });
      setRecoverOpen(false);
      setRecoveryInput('');
      setRecoveryPassword('');
      setRecoveryCode(result.recoveryCode);
      security.reload();
      settings.reload();
      toast('استُعيدت كلمة المرور. احفظ رمز الاسترداد الجديد.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر الاسترداد.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function backupNow() {    setBusy(true);
    try {
      const result = await runElevated(() =>
        api<{ name: string }>('/api/backup', { method: 'POST' }),
      );
      toast(`أُنشئت النسخة ${result.name}.`, 'success');
      backups.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّرت النسخة الاحتياطية.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStartup() {
    if (!window.workspace || startup === null) return;
    try {
      const next = await window.workspace.setStartup(!startup);
      setStartup(next);
      toast(next ? 'سيبدأ Workspace مع ويندوز.' : 'أُلغي البدء التلقائي.', 'success');
    } catch {
      toast('تعذّر تغيير إعداد البدء التلقائي.', 'error');
    }
  }

  if (!form) {
    return (
      <Card>
        <Spinner label="تحميل الإعدادات…" />
      </Card>
    );
  }

  const failedTools = doctor.data?.tools.filter((tool) => tool.status === 'fail') ?? [];

  return (
    <div className="settings-layout">
      <aside className="settings-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-tab ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      <div className="settings-body">
        {tab === 'office' && (
          <div className="stack">
            <Card>
              <SectionHeader title="هوية المكتب" description="تظهر في الواجهة وملفات المكتب." />
              <div className="form-grid">
                <Field label="اسم المكتب" span>
                  <Input
                    value={form.office.name}
                    onChange={(event) =>
                      setForm({ ...form, office: { ...form.office, name: event.target.value } })
                    }
                  />
                </Field>
                <Field label="المظهر">
                  <Select
                    value={theme}
                    onChange={(event) => {
                      const next = event.target.value as 'dark' | 'light';
                      setTheme(next);
                      setForm({ ...form, ui: { ...form.ui, theme: next } });
                    }}
                  >
                    <option value="dark">داكن</option>
                    <option value="light">فاتح</option>
                  </Select>
                </Field>
              </div>
              <div className="form-actions">
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() =>
                    void save({ office: { name: form.office.name }, ui: { theme } }, 'حُفظ اسم المكتب.')
                  }
                >
                  حفظ
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader title="معلومات التشغيل" description="تظهر في حزمة التشخيص." />
              <div className="tech-grid">
                <KeyValue label="إصدار التطبيق">
                  <code dir="ltr">{window.workspace?.appVersion}</code>
                </KeyValue>
                <KeyValue label="النظام">
                  <code dir="ltr">
                    {window.workspace?.platform} / {window.workspace?.arch}
                  </code>
                </KeyValue>
                <KeyValue label="مجلد المكتب">
                  <code dir="ltr">{window.workspace?.officeDir}</code>
                </KeyValue>
              </div>
              <div className="form-actions">
                <Button icon="folder" onClick={() => void window.workspace?.openPath(window.workspace.officeDir)}>
                  فتح مجلد المكتب
                </Button>
              </div>
            </Card>
          </div>
        )}

        {tab === 'storage' && (
          <div className="stack">
            <Card>
              <SectionHeader
                title="تسجيل قرص"
                description="الهوية تُكتب في جذر القرص، والمسارات تُخزَّن نسبية."
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="refresh"
                    onClick={() =>
                      void api('/api/volumes/scan', { method: 'POST' })
                        .then(() => {
                          volumes.reload();
                          toast('أُعيد فحص الأقراص.', 'success');
                        })
                        .catch(() => toast('تعذّر فحص الأقراص.', 'error'))
                    }
                  >
                    إعادة فحص
                  </Button>
                }
              />
              <div className="form-grid">
                <Field label="مجلد الجذر" span required>
                  <div className="input-row">
                    <Input
                      dir="ltr"
                      value={volumeForm.root}
                      onChange={(event) => setVolumeForm({ ...volumeForm, root: event.target.value })}
                      placeholder="D:\\Media"
                    />
                    <Button icon="folder" onClick={() => void chooseVolumeFolder()}>
                      اختيار
                    </Button>
                  </div>
                </Field>
                <Field label="الاسم">
                  <Input
                    value={volumeForm.label}
                    onChange={(event) => setVolumeForm({ ...volumeForm, label: event.target.value })}
                  />
                </Field>
                <Field label="النوع">
                  <Select
                    value={volumeForm.kind}
                    onChange={(event) =>
                      setVolumeForm({ ...volumeForm, kind: event.target.value as 'hot' | 'cold' })
                    }
                  >
                    <option value="hot">ساخن — العمل اليومي</option>
                    <option value="cold">بارد — أرشيف</option>
                  </Select>
                </Field>
              </div>
              <div className="form-actions">
                <Button variant="primary" icon="plus" loading={busy} onClick={() => void registerVolume()}>
                  تسجيل القرص
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader title="الأقراص المسجّلة" description={`${volumes.data?.length ?? 0} قرص`} />
              {volumes.data && volumes.data.length > 0 ? (
                <div className="table">
                  <div className="table__head">
                    <span>القرص</span>
                    <span>النوع</span>
                    <span>الحالة</span>
                    <span>الحرة</span>
                    <span>المسار الحالي</span>
                  </div>
                  {volumes.data.map((volume) => (
                    <div className="table__row" key={volume.id}>
                      <span>{volume.label}</span>
                      <span>{volume.kind === 'hot' ? 'ساخن' : 'بارد'}</span>
                      <Badge
                        tone={volume.status === 'connected' ? 'green' : volume.status === 'offline' ? 'red' : 'gold'}
                      >
                        {volume.status === 'connected'
                          ? 'متصل'
                          : volume.status === 'offline'
                            ? 'غير موصول'
                            : volume.status === 'cloned'
                              ? 'نسخة مكررة'
                              : volume.status}
                      </Badge>
                      <span>{formatBytes(volume.freeBytes)}</span>
                      <code className="tiny" dir="ltr">
                        {volume.root ?? '—'}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="disk"
                  title="لا أقراص مسجّلة"
                  description="سجّل قرصًا ساخنًا أولًا؛ فيه تعيش قاعدة البيانات والملفات."
                />
              )}
            </Card>
          </div>
        )}

        {tab === 'environment' && (
          <div className="stack">
            <Card>
              <SectionHeader
                title="فحص البيئة"
                description="فحص فعلي للأدوات، لا مجرد وجودها في PATH."
                action={
                  <div className="row gap">
                    <Button size="sm" icon="scan" loading={busy} onClick={() => void runDoctor(false)}>
                      فحص سريع
                    </Button>
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => void runDoctor(true)}>
                      فحص عميق
                    </Button>
                  </div>
                }
              />
              {doctor.data ? (
                <>
                  <div className="doctor-summary">
                    <Badge tone={doctor.data.ok ? 'green' : 'red'} dot>
                      {doctor.data.ok ? 'البيئة جاهزة' : 'البيئة ناقصة'}
                    </Badge>
                    <span className="muted small">آخر فحص {formatDateTime(doctor.data.checkedAt)}</span>
                    <span className="muted small">
                      {doctor.data.cpus} نواة · {doctor.data.totalMemoryGb}GB RAM
                    </span>
                  </div>
                  <div className="tool-list">
                    {doctor.data.tools.map((tool) => (
                      <div className="tool" key={tool.id}>
                        <div className={`tool__icon tool__icon--${toolTone(tool.status)}`}>
                          <Icon
                            name={
                              tool.id === 'gpu'
                                ? 'spark'
                                : tool.id === 'ffmpeg'
                                  ? 'film'
                                  : tool.id === 'python'
                                    ? 'activity'
                                    : tool.id === 'opencode'
                                      ? 'review'
                                      : 'settings'
                            }
                            size={17}
                          />
                        </div>
                        <div className="tool__body">
                          <strong>
                            {tool.label} {tool.version && <code dir="ltr">{tool.version}</code>}
                          </strong>
                          {tool.detail && <span className="muted tiny">{tool.detail}</span>}
                          {tool.action && tool.status !== 'ok' && (
                            <span className="tool__action">{tool.action}</span>
                          )}
                        </div>
                        <Badge tone={toolTone(tool.status)}>
                          {tool.status === 'ok' ? 'جاهز' : tool.status === 'warn' ? 'تحذير' : 'ناقص'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {failedTools.length > 0 && (
                    <p className="form-error small">
                      الوظائف الآلية لا تبدأ حتى تصبح كل المتطلبات الإلزامية خضراء.
                    </p>
                  )}
                </>
              ) : (
                <EmptyState
                  icon="scan"
                  title="لم يُجرَ فحص بعد"
                  description="افحص FFmpeg وPython وOpenCode وبطاقة الشاشة."
                  action={
                    <Button size="sm" icon="scan" onClick={() => void runDoctor(false)}>
                      ابدأ الفحص
                    </Button>
                  }
                />
              )}
            </Card>

            <Card>
              <SectionHeader
                title="الأساليب المثبتة"
                description="حزم بيانات من مجلد styles — لا منطق في الكود."
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="refresh"
                    loading={busy}
                    onClick={() =>
                      void runElevated(async () => {
                        await api('/api/styles/reload', { method: 'POST' });
                        styles.reload();
                        toast('أُعيد تحميل الأساليب.', 'success');
                      })
                    }
                  >
                    إعادة تحميل
                  </Button>
                }
              />
              {styles.data && styles.data.length > 0 ? (
                <div className="style-list">
                  {styles.data.map((style) => (
                    <div className="style" key={style.id}>
                      <div className="style__icon">
                        <Icon name="film" size={18} />
                      </div>
                      <div className="style__body">
                        <strong>
                          {style.name} <code dir="ltr">{style.version}</code>
                        </strong>
                        <span className="muted tiny">{style.description || 'بلا وصف'}</span>
                        <span className="muted tiny">
                          {style.estMinutes} دقيقة · {style.checklist.length} بنود تحقق ·{' '}
                          {style.gpu ? 'GPU' : 'بلا GPU'}
                        </span>
                      </div>
                      <Badge tone={style.enabled ? 'green' : 'neutral'}>
                        {style.enabled ? 'مفعّل' : 'معطّل'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="film"
                  title="لا أساليب"
                  description="أضف حزمة أسلوب إلى مجلد styles ثم أعد التحميل."
                />
              )}
            </Card>
          </div>
        )}

        {tab === 'workflow' && (
          <div className="stack">
            <Card>
              <SectionHeader title="الطابور" description="عامل واحد؛ منع النوم أثناء العمل." />
              <div className="form-grid">
                <Field label="نافذة ليلية" hint="وظائف «تلقائي» لا تبدأ خارجها.">
                  <Select
                    value={form.queue.nightWindow.enabled ? '1' : '0'}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        queue: {
                          ...form.queue,
                          nightWindow: { ...form.queue.nightWindow, enabled: event.target.value === '1' },
                        },
                      })
                    }
                  >
                    <option value="0">معطّلة</option>
                    <option value="1">مفعّلة</option>
                  </Select>
                </Field>
                <Field label="من">
                  <Input
                    type="time"
                    value={form.queue.nightWindow.start}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        queue: {
                          ...form.queue,
                          nightWindow: { ...form.queue.nightWindow, start: event.target.value },
                        },
                      })
                    }
                  />
                </Field>
                <Field label="إلى">
                  <Input
                    type="time"
                    value={form.queue.nightWindow.end}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        queue: {
                          ...form.queue,
                          nightWindow: { ...form.queue.nightWindow, end: event.target.value },
                        },
                      })
                    }
                  />
                </Field>
                <Field label="أقصى مدة افتراضية (دقيقة)">
                  <Input
                    type="number"
                    min={1}
                    value={form.queue.defaultMaxMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        queue: { ...form.queue, defaultMaxMinutes: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button variant="primary" loading={busy} onClick={() => void save({ queue: form.queue })}>
                  حفظ الطابور
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader title="الوكيل" description="OpenCode لتنفيذ الأساليب، أو الوضع التجريبي للاختبار." />
              <div className="form-grid">
                <Field label="المحوّل">
                  <Select
                    value={form.agent.adapter}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        agent: { ...form.agent, adapter: event.target.value as 'mock' | 'opencode' },
                      })
                    }
                  >
                    <option value="mock">تجريبي (Mock)</option>
                    <option value="opencode">OpenCode</option>
                  </Select>
                </Field>
                <Field label="عنوان OpenCode" hint="لم يعد مستخدمًا في V2؛ CLI يكتشف الخادم تلقائيًا.">
                  <Input
                    dir="ltr"
                    value={form.agent.baseUrl}
                    onChange={(event) =>
                      setForm({ ...form, agent: { ...form.agent, baseUrl: event.target.value } })
                    }
                  />
                </Field>
                <Field label="مسار OpenCode" hint="اسم الأمر أو مسار opencode.exe.">
                  <Input
                    dir="ltr"
                    value={form.agent.opencodePath}
                    onChange={(event) =>
                      setForm({ ...form, agent: { ...form.agent, opencodePath: event.target.value } })
                    }
                  />
                </Field>
                <Field label="النموذج" hint="بصيغة provider/model إن كان الخادم يحتاجه.">
                  <Input
                    dir="ltr"
                    value={form.agent.model ?? ''}
                    onChange={(event) =>
                      setForm({ ...form, agent: { ...form.agent, model: event.target.value || null } })
                    }
                  />
                </Field>
                <Field label="تأخير المحاكاة (ms)">
                  <Input
                    type="number"
                    min={0}
                    value={form.agent.mockDelayMs}
                    onChange={(event) =>
                      setForm({ ...form, agent: { ...form.agent, mockDelayMs: Number(event.target.value) } })
                    }
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button variant="primary" loading={busy} onClick={() => void save({ agent: form.agent })}>
                  حفظ الوكيل
                </Button>
                <Button
                  icon="scan"
                  onClick={async () => {
                    const result = await api<{ ok: boolean; adapter: string; message: string | null }>(
                      '/api/agent/check',
                      { method: 'POST' },
                    );
                    toast(
                      result.ok
                        ? `الاتصال بالوكيل (${result.adapter}) ناجح.`
                        : result.message ?? 'تعذّر الاتصال بالوكيل.',
                      result.ok ? 'success' : 'error',
                    );
                  }}
                >
                  اختبار الاتصال
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="جسر Premiere"
                description="يثبّت لوحة Workspace داخل Premiere لإنشاء المشاريع تلقائيًا."
                action={
                  <Button
                    size="sm"
                    icon="download"
                    onClick={async () => {
                      const result = await window.workspace?.installPremiereBridge();
                      toast(
                        result?.ok
                          ? 'ثُبّت الجسر. افتح Premiere ← Window ← Extensions ← Workspace Bridge.'
                          : result?.message ?? 'تعذّر تثبيت الجسر.',
                        result?.ok ? 'success' : 'error',
                      );
                    }}
                  >
                    تثبيت الجسر
                  </Button>
                }
              />
              <p className="muted small">
                يفعّل اللوحة غير الموقّعة عبر PlayerDebugMode. على جهاز المكتب الموثوق فقط.
                بعد التثبيت أدخل مسار المكتب مرة واحدة في اللوحة.
              </p>
            </Card>

            <Card>
              <SectionHeader title="الأرشيف" description="متى يصبح الحدث مرشحًا، وكم يبقى في السلة." />
              <div className="form-grid">
                <Field label="الاحتفاظ الساخن (أيام)">
                  <Input
                    type="number"
                    min={0}
                    value={form.archive.retentionDays}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        archive: { ...form.archive, retentionDays: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
                <Field label="سلة المحذوفات (أيام)">
                  <Input
                    type="number"
                    min={1}
                    value={form.archive.trashDays}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        archive: { ...form.archive, trashDays: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
                <Field label="بعد التحقق">
                  <Select
                    value={form.archive.trashAfterArchive ? '1' : '0'}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        archive: {
                          ...form.archive,
                          trashAfterArchive: event.target.value === '1',
                        },
                      })
                    }
                  >
                    <option value="1">انقل المصدر إلى السلة</option>
                    <option value="0">أبقِ المصدر في مكانه</option>
                  </Select>
                </Field>
              </div>
              <div className="form-actions">
                <Button variant="primary" loading={busy} onClick={() => void save({ archive: form.archive })}>
                  حفظ الأرشيف
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader title="التفريغ" description="حدود المساحة والنسخ." />
              <div className="form-grid">
                <Field label="محرّك النسخ">
                  <Select
                    value={form.ingest.copyEngine}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        ingest: { ...form.ingest, copyEngine: event.target.value as 'auto' | 'node' | 'robocopy' },
                      })
                    }
                  >
                    <option value="auto">تلقائي</option>
                    <option value="node">Node (متوافق)</option>
                    <option value="robocopy">Robocopy (ويندوز)</option>
                  </Select>
                </Field>
                <Field label="ملفات متزامنة">
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    value={form.ingest.concurrentFiles}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        ingest: { ...form.ingest, concurrentFiles: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
                <Field label="تحذير المساحة (GB)">
                  <Input
                    type="number"
                    min={1}
                    value={form.ingest.warnBelowGb}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        ingest: { ...form.ingest, warnBelowGb: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
                <Field label="منع المساحة (GB)">
                  <Input
                    type="number"
                    min={1}
                    value={form.ingest.blockBelowGb}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        ingest: { ...form.ingest, blockBelowGb: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button variant="primary" loading={busy} onClick={() => void save({ ingest: form.ingest })}>
                  حفظ التفريغ
                </Button>
              </div>
            </Card>
          </div>
        )}

        {tab === 'security' && (
          <div className="stack">
            <Card>
              <SectionHeader
                title="حماية الإجراءات"
                description="كلمة مرور مشتركة تحمي من الخطأ، لا من الخائن. تُسجَّل كل عملية."
              />
              <div className="doctor-summary">
                <Badge tone={security.data?.hasPassword ? 'green' : 'gold'} dot>
                  {security.data?.hasPassword ? 'كلمة المرور مفعّلة' : 'لا توجد كلمة مرور'}
                </Badge>
                {security.data?.elevatedUntil && (
                  <Badge tone="blue">الصلاحية مفتوحة حتى {formatDateTime(security.data.elevatedUntil)}</Badge>
                )}
                {security.data?.lockedForSeconds ? (
                  <Badge tone="red">مقفل {security.data.lockedForSeconds} ثانية</Badge>
                ) : null}
              </div>
              <div className="form-actions">
                <Button variant="primary" icon="shield" onClick={() => setPasswordOpen(true)}>
                  {security.data?.hasPassword ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور'}
                </Button>
                {security.data?.hasPassword && (
                  <Button variant="ghost" onClick={() => setRecoverOpen(true)}>
                    نسيت كلمة المرور؟
                  </Button>
                )}
              </div>
              <div className="form-grid">
                <Field label="مدة الصلاحية المرتفعة (دقيقة)" hint="تُقفل الصلاحية تلقائيًا بعد هذه المدة.">
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={form.security.idleLockMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        security: { ...form.security, idleLockMinutes: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button
                  loading={busy}
                  onClick={() => void save({ security: { idleLockMinutes: form.security.idleLockMinutes } })}
                >
                  حفظ مدة الصلاحية
                </Button>
              </div>
            </Card>

            <Card>
              <SectionHeader title="الإجراءات المقفلة" description="تُطلب كلمة المرور مرة واحدة ثم تُفتح 10 دقائق." />
              <ul className="plain-list">
                <li>تعديل الأعضاء والإعدادات العامة.</li>
                <li>حذف أو أرشفة نهائية.</li>
                <li>اعتماد النشر النهائي.</li>
                <li>تعديل الأساليب أو مسارات التخزين.</li>
              </ul>
            </Card>
          </div>
        )}

        {tab === 'data' && (
          <div className="stack">
            <Card>
              <SectionHeader
                title="بدء التشغيل"
                description="فتح Workspace تلقائيًا مع ويندوز (النسخة المثبتة فقط)."
                action={
                  <Button
                    size="sm"
                    icon="settings"
                    onClick={() => void toggleStartup()}
                    disabled={!window.workspace?.isPackaged || startup === null}
                  >
                    {startup ? 'إيقاف البدء التلقائي' : 'تشغيل مع ويندوز'}
                  </Button>
                }
              />
              <p className="muted small">
                {window.workspace?.isPackaged
                  ? startup
                    ? 'مفعّل: يفتح التطبيق تلقائيًا عند بدء التشغيل.'
                    : 'غير مفعّل.'
                  : 'غير متاح في وضع التطوير أو النسخة المحمولة.'}
              </p>
            </Card>

            <Card>
              <SectionHeader
                title="النسخ الاحتياطي"
                description="نسخة كاملة من قاعدة البيانات مع فحص WAL. تُحفظ 14 نسخة."
                action={
                  <Button size="sm" icon="download" loading={busy} onClick={() => void backupNow()}>
                    نسخة الآن
                  </Button>
                }
              />
              {backups.data && backups.data.length > 0 ? (
                <div className="table">
                  <div className="table__head">
                    <span>الملف</span>
                    <span>الحجم</span>
                    <span>التاريخ</span>
                  </div>
                  {backups.data.map((backup) => (
                    <div className="table__row" key={backup.name}>
                      <code className="tiny" dir="ltr">
                        {backup.name}
                      </code>
                      <span>{formatBytes(backup.bytes)}</span>
                      <span>{formatDateTime(backup.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="archive"
                  title="لا نسخ بعد"
                  description="أنشئ نسخة قبل أي ترحيل أو تحديث."
                />
              )}
            </Card>

            <Card>
              <SectionHeader
                title="التشخيص"
                description="حزمة JSON تحوي السجلات والفحص والإعدادات المنقّحة — بلا مسارات ملفات."
              />
              <div className="form-actions">
                <Button
                  icon="download"
                  onClick={() =>
                    void downloadDiagnostics()
                      .then(() => toast('نُزّلت حزمة التشخيص.', 'success'))
                      .catch(() => toast('تعذّر إنشاء الحزمة.', 'error'))
                  }
                >
                  تنزيل حزمة التشخيص
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal
        open={passwordOpen}
        title={security.data?.hasPassword ? 'تغيير كلمة مرور المكتب' : 'تعيين كلمة مرور المكتب'}
        description="تُطلب للإجراءات الحساسة. لا تُخزَّن كنص، ويُعرض رمز استرداد مرة واحدة."
        onClose={() => setPasswordOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void savePassword()}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="كلمة المرور" span required>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="التأكيد" span required>
            <Input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={recoverOpen}
        title="استرداد بكلمة المرور"
        description="استخدم رمز الاسترداد الذي حفظته خارج الجهاز. سيُستهلك ويُولَّد رمز جديد."
        onClose={() => setRecoverOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecoverOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void recoverPassword()}>
              استرداد
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="رمز الاسترداد" span required>
            <Input
              dir="ltr"
              value={recoveryInput}
              onChange={(event) => setRecoveryInput(event.target.value)}
              placeholder="A1B2C3D4E5"
            />
          </Field>
          <Field label="كلمة المرور الجديدة" span required>
            <Input
              type="password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={recoveryCode !== null}
        title="رمز الاسترداد"        description="يُعرض مرة واحدة فقط. احفظه خارج هذا الجهاز."
        onClose={() => setRecoveryCode(null)}
        footer={
          <Button variant="primary" onClick={() => setRecoveryCode(null)}>
            حفظته
          </Button>
        }
      >
        <div className="recovery-code" dir="ltr">
          {recoveryCode}
        </div>
        <p className="muted small">
          لا يوجد بريد ولا «نسيت كلمة المرور». هذا الرمز هو طريقك الوحيد للاستعادة.
        </p>
      </Modal>
    </div>
  );
}
