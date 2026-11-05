import { useEffect, useMemo, useState } from 'react';
import type { EngineInfo, User, VolumeView } from '../shared/models.js';
import { Icon, type IconName } from './components/Icon';
import { Badge, Button, Field, Input, Modal, Select } from './components/ui';
import { useApi, useHashRoute } from './lib/hooks';
import { useApp } from './lib/app-context';
import { api, getActorId, setActorId } from './lib/api';
import { Dashboard } from './screens/Dashboard';
import { Inbox } from './screens/Inbox';
import { Library } from './screens/Library';
import { EventDetail } from './screens/EventDetail';
import { Review } from './screens/Review';
import { EditTasks } from './screens/EditTasks';
import { Archive } from './screens/Archive';
import { Settings } from './screens/Settings';
import { Activity } from './screens/Activity';
import { formatBytes } from './lib/format';

const NAV: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/dashboard', label: 'اليوم', icon: 'dashboard' },
  { path: '/inbox', label: 'الوارد', icon: 'inbox' },
  { path: '/library', label: 'المكتبة', icon: 'library' },
  { path: '/montage', label: 'المونتاج', icon: 'film' },
  { path: '/review', label: 'المراجعة', icon: 'review' },
  { path: '/archive', label: 'الأرشيف', icon: 'archive' },
  { path: '/activity', label: 'السجل', icon: 'activity' },
  { path: '/settings', label: 'الإعدادات', icon: 'settings' },
];

const TITLES: Record<string, string> = {
  dashboard: 'اليوم',
  inbox: 'الوارد',
  library: 'المكتبة',
  montage: 'المونتاج',
  review: 'المراجعة',
  archive: 'الأرشيف',
  activity: 'سجل النشاط',
  settings: 'الإعدادات',
  events: 'تفاصيل الحدث',
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'مسؤول المكتب',
  editor: 'منفّذ',
  reviewer: 'مراجع',
  member: 'عضو',
};

export function App() {
  const route = useHashRoute();
  const { theme, setTheme, toast, runElevated } = useApp();
  const { data: info } = useApi<EngineInfo>('/api/info');
  const { data: volumes } = useApi<VolumeView[]>('/api/volumes');
  const users = useApi<User[]>('/api/users');
  const [userOpen, setUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', role: 'member' });
  const [savingUser, setSavingUser] = useState(false);

  const currentUser =
    users.data?.find((user) => user.id === getActorId() && user.active) ??
    users.data?.find((user) => user.active) ??
    null;

  useEffect(() => {
    if (!users.data || users.data.length === 0) return;
    if (!users.data.some((user) => user.id === getActorId() && user.active)) {
      const fallback = users.data.find((user) => user.active);
      if (fallback) setActorId(fallback.id);
    }
    if (!localStorage.getItem('workspace.actorPicked')) setUserOpen(true);
  }, [users.data]);

  async function createUser() {
    if (newUser.name.trim().length < 2) {
      toast('اكتب اسم المستخدم أولًا.', 'error');
      return;
    }
    setSavingUser(true);
    try {
      const created = await runElevated(() =>
        api<User>('/api/users', { method: 'POST', body: newUser }),
      );
      setActorId(created.id);
      localStorage.setItem('workspace.actorPicked', '1');
      users.reload();
      setUserOpen(false);
      setNewUser({ name: '', role: 'member' });
      toast(`مرحبًا ${created.name}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذّر إنشاء المستخدم.', 'error');
    } finally {
      setSavingUser(false);
    }
  }

  function pickUser(user: User) {
    setActorId(user.id);
    localStorage.setItem('workspace.actorPicked', '1');
    setUserOpen(false);
    toast(`أنت تعمل الآن باسم ${user.name}.`, 'info');
  }

  if (!window.workspace) {
    return (
      <div className="boot">
        <div className="boot__card">
          <div className="brand-mark">W</div>
          <h1>Workspace</h1>
          <p>هذه الواجهة تعمل داخل تطبيق سطح المكتب فقط.</p>
          <p className="muted">شغّل <code>Workspace.exe</code> أو <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }

  const pathPart = route.split('?')[0] ?? route;
  const query = new URLSearchParams(route.split('?')[1] ?? '');
  const section = pathPart.split('/')[1] ?? 'dashboard';
  const eventId = pathPart.startsWith('/events/') ? pathPart.slice('/events/'.length) : null;
  const reviewJobId = pathPart.startsWith('/review/') ? pathPart.slice('/review/'.length) : null;
  const initialEventId = query.get('event');
  const hotVolume = volumes?.find((volume) => volume.kind === 'hot' && volume.root);
  const reviewCount = info?.queue.review ?? 0;

  const content = useMemo(() => {
    if (eventId) return <EventDetail eventId={eventId} />;
    switch (section) {
      case 'inbox':
        return <Inbox />;
      case 'library':
        return <Library />;
      case 'montage':
        return <EditTasks initialEventId={initialEventId} />;
      case 'review':
        return <Review initialJobId={reviewJobId} />;
      case 'archive':
        return <Archive />;
      case 'settings':
        return <Settings />;
      case 'activity':
        return <Activity />;
      default:
        return <Dashboard />;
    }
  }, [eventId, initialEventId, reviewJobId, section]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div className="brand__text">
            <strong>Workspace</strong>
            <span>كل المكتب في نافذة واحدة</span>
          </div>
        </div>

        <nav className="nav" aria-label="التنقل الرئيسي">
          {NAV.map((item) => {
            const active =
              item.path === `/${section}` || (item.path === '/library' && section === 'events');
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                className={`nav__item ${active ? 'nav__item--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={19} />
                <span>{item.label}</span>
                {item.path === '/review' && reviewCount > 0 && (
                  <span className="nav__count">{reviewCount}</span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="sidebar__foot">
          <div className="engine-state">
            <span className={`dot ${info ? 'dot--ok' : 'dot--bad'}`} />
            <span>{info ? 'المحرّك متصل' : 'المحرّك غير متصل'}</span>
          </div>
          <span className="muted tiny">الإصدار {info?.version ?? '—'}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <span className="eyebrow">{info?.office.name ?? 'مكتب الوسائط'}</span>
            <h1>{eventId ? TITLES.events : TITLES[section] ?? 'Workspace'}</h1>
          </div>

          <div className="topbar__status">
            <button type="button" className="user-chip" onClick={() => setUserOpen(true)}>
              <span className="user-chip__avatar">{currentUser?.name.slice(0, 1) ?? '؟'}</span>
              <span className="user-chip__text">
                <strong>{currentUser?.name ?? 'اختر المستخدم'}</strong>
                <small>{currentUser ? ROLE_LABELS[currentUser.role] ?? currentUser.role : 'من أنت؟'}</small>
              </span>
            </button>
            {(info?.queue.running ?? 0) > 0 && (
              <Badge tone="blue" dot>
                وظيفة قيد التنفيذ
              </Badge>
            )}
            {(info?.queue.queued ?? 0) > 0 && <Badge tone="neutral">{info?.queue.queued} في الطابور</Badge>}
            {hotVolume && (
              <span className="chip" title="مساحة القرص الساخن">
                <Icon name="disk" size={15} />
                {formatBytes(hotVolume.freeBytes)} حرة
              </span>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="تبديل المظهر"
              title="تبديل المظهر"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Icon name={theme === 'dark' ? 'spark' : 'clock'} size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="فتح مجلد المكتب"
              title="فتح مجلد المكتب"
              onClick={() => void window.workspace?.openPath(window.workspace.officeDir)}
            >
              <Icon name="folder" size={18} />
            </button>
          </div>
        </header>

        <main className="content">{content}</main>
      </div>

      <Modal
        open={userOpen}
        title="من يعمل الآن؟"
        description="حساب محلي بلا كلمة مرور. كل إجراء يُسجَّل باسم المستخدم المختار."
        onClose={() => setUserOpen(false)}
        footer={
          <Button variant="ghost" onClick={() => setUserOpen(false)}>
            إغلاق
          </Button>
        }
      >
        <div className="user-list">
          {(users.data ?? []).filter((user) => user.active).map((user) => (
            <button
              type="button"
              key={user.id}
              className={`user-option ${user.id === currentUser?.id ? 'is-active' : ''}`}
              onClick={() => pickUser(user)}
            >
              <span className="user-chip__avatar">{user.name.slice(0, 1)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{ROLE_LABELS[user.role] ?? user.role}</small>
              </span>
              {user.id === currentUser?.id && <Icon name="check" size={17} />}
            </button>
          ))}
        </div>
        <div className="user-add">
          <span className="eyebrow">إضافة مستخدم</span>
          <div className="form-grid">
            <Field label="الاسم" span>
              <Input
                value={newUser.name}
                onChange={(event) => setNewUser({ ...newUser, name: event.target.value })}
                placeholder="مثال: أحمد"
              />
            </Field>
            <Field label="الدور">
              <Select
                value={newUser.role}
                onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
              >
                <option value="owner">مسؤول المكتب</option>
                <option value="editor">منفّذ</option>
                <option value="reviewer">مراجع</option>
                <option value="member">عضو</option>
              </Select>
            </Field>
          </div>
          <Button variant="primary" icon="plus" loading={savingUser} onClick={() => void createUser()}>
            إضافة واختيار
          </Button>
        </div>
      </Modal>
    </div>
  );
}
