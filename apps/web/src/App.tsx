import { useState, useEffect, useRef } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  House,
  UsersRound,
  ClipboardList,
  CalendarDays,
  Settings,
  Plus,
  WifiOff,
  Sun,
  Moon,
} from 'lucide-react';
import { api, send, type Overview } from './api';
import { todayInZone } from '../../../packages/shared/src/rules';
import { Button, ErrorBox, Loading } from './ui';
import { TeamPage, WeekPage, SettingsPage } from './pages';
import { OverviewPage, TasksPage } from './farm-pages';
import { MemberDrawer, TaskDrawer, TaskFormDrawer } from './drawers';
import { TaskActionProvider } from './task-actions';

export type OpenTaskDefaults = {
  ownerId?: string;
  groupId?: string;
  deadline?: string;
  projectName?: string;
};
const nav = [
  ['/', '今天', House],
  ['/team', '团队', UsersRound],
  ['/tasks', '任务', ClipboardList],
  ['/week', '日历', CalendarDays],
] as const;
export default function App() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.localStorage.getItem('houlai-theme') === 'dark' ? 'dark' : 'light',
  );
  const [wallpaperShade, setWallpaperShade] = useState(() => {
    const value = Number(window.localStorage.getItem('houlai-wallpaper-shade'));
    return Number.isFinite(value) && value >= 35 && value <= 95
      ? Math.round((value - 35) / 5) * 5 + 35
      : 80;
  });
  const [password, setPassword] = useState(''),
    [loginError, setLoginError] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null),
    [memberId, setMemberId] = useState<string | null>(null),
    [create, setCreate] = useState<OpenTaskDefaults | null>(null);
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') });
  const appearance = useQuery({
    queryKey: ['appearance'],
    queryFn: () => api<{ backgroundMediaId: string | null }>('/appearance'),
  });
  const epoch = useRef<string | undefined>(undefined);
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('houlai-theme', theme);
  }, [theme]);
  useEffect(() => {
    window.localStorage.setItem('houlai-wallpaper-shade', String(wallpaperShade));
  }, [wallpaperShade]);
  useEffect(() => {
    if (!overview.data?.epoch) return;
    if (epoch.current && epoch.current !== overview.data.epoch) window.location.reload();
    epoch.current = overview.data.epoch;
  }, [overview.data?.epoch]);
  useEffect(() => {
    if (!overview.data?.today || !overview.data.timezone) return;
    const checkDay = () => {
      if (todayInZone(overview.data!.timezone) !== overview.data!.today)
        void qc.invalidateQueries();
    };
    const refresh = () => void qc.invalidateQueries();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(checkDay, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [overview.data?.today, overview.data?.timezone, qc]);
  const location = useLocation();
  const title =
    location.pathname === '/settings'
      ? '设置'
      : nav.find((x) => x[0] === location.pathname)?.[1] || '今天';
  const isToday = location.pathname === '/';
  const actions = {
    openTask: setTaskId,
    openMember: setMemberId,
    newTask: (defaults: OpenTaskDefaults = {}) => setCreate(defaults),
  };
  if ((overview.error as any)?.status === 401)
    return (
      <div className="login-page">
        <div className="login-card">
          <img className="login-sprout" src="/assets/farm/sprout.png" alt="" />
          <h1>访问后来居上组管理后台</h1>
          <p>输入这台主机设置的局域网访问口令。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLoginError('');
              try {
                await send('/auth/login', 'POST', { password });
                setPassword('');
                await qc.invalidateQueries();
              } catch (err) {
                setLoginError((err as Error).message);
              }
            }}
          >
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="访问口令"
              aria-label="访问口令"
            />
            <Button type="submit">进入工作台</Button>
          </form>
          {loginError && <p className="form-error">{loginError}</p>}
        </div>
      </div>
    );
  return (
    <TaskActionProvider onNext={(defaults) => setCreate(defaults)}>
      <div
        className={`app-shell ${appearance.data?.backgroundMediaId ? 'has-wallpaper' : ''}`}
        style={
          appearance.data?.backgroundMediaId
            ? { backgroundImage: `url('/api/media/${appearance.data.backgroundMediaId}')` }
            : undefined
        }
      >
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-sprout" src="/assets/farm/sprout.png" alt="" />
            <div>
              <strong>后来居上</strong>
              <span>组管理后台</span>
            </div>
          </div>
          <nav aria-label="主导航">
            {nav.map(([to, label, Icon]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                title={label}
                aria-label={label}
              >
                <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-garden" aria-hidden="true">
              <img src="/assets/farm/sidebar-garden.png" alt="" />
              <span>
                种下今天
                <br />
                长出明天
              </span>
            </div>
            <NavLink
              to="/settings"
              className={({ isActive }) => `nav-item settings-link ${isActive ? 'active' : ''}`}
              aria-label="设置"
            >
              <Settings size={20} strokeWidth={2.2} aria-hidden="true" />
              <span>设置</span>
            </NavLink>
          </div>
        </aside>
        <div
          className={`main-area ${appearance.data?.backgroundMediaId ? 'has-background' : ''}`}
          style={
            appearance.data?.backgroundMediaId
              ? {
                  backgroundColor: `rgba(${theme === 'dark' ? '25,32,27' : '247,241,228'},${wallpaperShade / 100})`,
                }
              : undefined
          }
        >
          <div className={`farm-banner ${isToday ? '' : 'farm-banner-compact'}`}>
            <div className="farm-banner-sign">
              <strong>晨光农场日志</strong>
              <span>把每天的事，种成看得见的进展</span>
            </div>
          </div>
          <header className="topbar">
            <div className="breadcrumb">
              <span>后来居上</span>
              <span className="slash" aria-hidden="true">
                /
              </span>
              <strong>{title}</strong>
            </div>
            <div className="top-actions">
              <Button
                variant="secondary"
                className="theme-switch"
                aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                {theme === 'light' ? '深色' : '浅色'}
              </Button>
              {overview.isError && (
                <span className="connection-error">
                  <WifiOff size={16} /> 连接中断
                </span>
              )}
              {!isToday && (
                <Button onClick={() => actions.newTask({})}>
                  <Plus size={17} /> 新任务
                </Button>
              )}
            </div>
          </header>
          <main className="content">
            {overview.isLoading ? (
              <Loading />
            ) : overview.isError ? (
              <ErrorBox error={overview.error} onRetry={() => overview.refetch()} />
            ) : (
              <Routes>
                <Route
                  path="/"
                  element={<OverviewPage data={overview.data!} actions={actions} />}
                />
                <Route
                  path="/team"
                  element={<TeamPage data={overview.data!} actions={actions} />}
                />
                <Route
                  path="/tasks"
                  element={<TasksPage data={overview.data!} actions={actions} />}
                />
                <Route
                  path="/week"
                  element={<WeekPage data={overview.data!} actions={actions} />}
                />
                <Route
                  path="/reviews"
                  element={<Navigate to="/tasks?status=pending_review" replace />}
                />
                <Route
                  path="/settings"
                  element={
                    <SettingsPage
                      data={overview.data!}
                      theme={theme}
                      onThemeChange={setTheme}
                      wallpaperShade={wallpaperShade}
                      onWallpaperShadeChange={setWallpaperShade}
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </main>
        </div>
        <TaskDrawer
          id={taskId}
          onClose={() => setTaskId(null)}
          onNext={(defaults) => {
            setTaskId(null);
            setCreate(defaults);
          }}
        />
        <MemberDrawer id={memberId} onClose={() => setMemberId(null)} actions={actions} />
        <TaskFormDrawer
          open={create !== null}
          defaults={create || {}}
          onClose={() => setCreate(null)}
          today={overview.data?.today || ''}
        />
      </div>
    </TaskActionProvider>
  );
}
