import { useMemo } from 'react';
import type { EngineInfo, VolumeView } from '../shared/models.js';
import { Icon, type IconName } from './components/Icon';
import { Badge } from './components/ui';
import { useApi, useHashRoute } from './lib/hooks';
import { useApp } from './lib/app-context';
import { Dashboard } from './screens/Dashboard';
import { Inbox } from './screens/Inbox';
import { Library } from './screens/Library';
import { EventDetail } from './screens/EventDetail';
import { Review } from './screens/Review';
import { Archive } from './screens/Archive';
import { Settings } from './screens/Settings';
import { Activity } from './screens/Activity';
import { formatBytes } from './lib/format';

const NAV: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/dashboard', label: 'اليوم', icon: 'dashboard' },
  { path: '/inbox', label: 'الوارد', icon: 'inbox' },
  { path: '/library', label: 'المكتبة', icon: 'library' },
  { path: '/review', label: 'المراجعة', icon: 'review' },
  { path: '/archive', label: 'الأرشيف', icon: 'archive' },
  { path: '/activity', label: 'السجل', icon: 'activity' },
  { path: '/settings', label: 'الإعدادات', icon: 'settings' },
];

const TITLES: Record<string, string> = {
  dashboard: 'اليوم',
  inbox: 'الوارد',
  library: 'المكتبة',
  review: 'المراجعة',
  archive: 'الأرشيف',
  activity: 'سجل النشاط',
  settings: 'الإعدادات',
  events: 'تفاصيل الحدث',
};

export function App() {
  const route = useHashRoute();
  const { theme, setTheme } = useApp();
  const { data: info } = useApi<EngineInfo>('/api/info');
  const { data: volumes } = useApi<VolumeView[]>('/api/volumes');

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

  const section = route.split('/')[1] ?? 'dashboard';
  const eventId = route.startsWith('/events/') ? route.slice('/events/'.length) : null;
  const reviewJobId = route.startsWith('/review/') ? route.slice('/review/'.length) : null;
  const hotVolume = volumes?.find((volume) => volume.kind === 'hot' && volume.root);
  const reviewCount = info?.queue.review ?? 0;

  const content = useMemo(() => {
    if (eventId) return <EventDetail eventId={eventId} />;
    switch (section) {
      case 'inbox':
        return <Inbox />;
      case 'library':
        return <Library />;
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
  }, [eventId, reviewJobId, section]);

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
    </div>
  );
}
