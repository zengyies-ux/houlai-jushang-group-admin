import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send, imageDataUrl, type Overview } from './api';
import { Button, Card, Field, Confirm, Loading, ErrorBox } from './ui';
type Backup = { name: string; size: number };
type Access = { local: boolean; lanEnabled: boolean; passwordSet: boolean; addresses: string[] };
type Meta = {
  appVersion: string;
  schemaVersion: number;
  commit: string;
  os: string;
  arch: string;
  node: string;
  dataDirectory: string | null;
};
export function SettingsPage({
  data,
  theme,
  onThemeChange,
  wallpaperShade,
  onWallpaperShadeChange,
}: {
  data: Overview;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  wallpaperShade: number;
  onWallpaperShadeChange: (value: number) => void;
}) {
  const qc = useQueryClient(),
    [zone, setZone] = useState(data.timezone),
    [password, setPassword] = useState(''),
    [enableLan, setEnableLan] = useState(true),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const access = useQuery({ queryKey: ['access'], queryFn: () => api<Access>('/settings/access') }),
    meta = useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta') }),
    appearance = useQuery({
      queryKey: ['appearance'],
      queryFn: () => api<{ backgroundMediaId: string | null }>('/appearance'),
    }),
    backups = useQuery({ queryKey: ['backups'], queryFn: () => api<Backup[]>('/backups') });
  const uploadBackground = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      const image = await imageDataUrl(file, 6 * 1024 * 1024);
      await send('/appearance/background', 'PUT', { image });
    }, '背景已更新');
  };
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await qc.invalidateQueries();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (name: string) => {
    setBusy(true);
    setMessage('');
    try {
      await send('/backups/restore', 'POST', { name, confirm: 'RESTORE' });
      window.location.reload();
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  };
  const restoreDefaultAppearance = () =>
    run(async () => {
      await send('/appearance/background', 'DELETE', {});
      onThemeChange('light');
      onWallpaperShadeChange(80);
    }, '已恢复晨光农场默认外观');
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">工作台设置</div>
          <h1>设置</h1>
          <p>安排外观与工作台规则，照看好重要数据。</p>
        </div>
      </div>
      {message && <p className="notice">{message}</p>}
      <div className="settings-grid">
        <Card className="settings-appearance">
          <div className="settings-card-title">
            <h2>农场外观</h2>
            <span>在这里调整你看到的工作台</span>
          </div>
          <p>浅色与深色偏好保存在当前浏览器；自定义背景随数据库备份保存。</p>
          <div className="display-modes" role="group" aria-label="显示模式">
            <Button
              variant={theme === 'light' ? 'primary' : 'secondary'}
              aria-pressed={theme === 'light'}
              onClick={() => onThemeChange('light')}
            >
              浅色模式
            </Button>
            <Button
              variant={theme === 'dark' ? 'primary' : 'secondary'}
              aria-pressed={theme === 'dark'}
              onClick={() => onThemeChange('dark')}
            >
              深色模式
            </Button>
          </div>
          <div className="appearance-wallpaper">
            <div>
              <h3>自定义背景</h3>
              <p>背景只装饰外层，信息仍显示在清楚的纸面上。支持 PNG、JPEG、WebP，最多 6 MB。</p>
              <input
                className="image-file-input"
                aria-label="选择背景图片"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void uploadBackground(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Field
                label={`背景遮罩强度 ${wallpaperShade}%`}
                hint="图片较亮或较暗时，可提高强度让内容更容易阅读。"
              >
                <input
                  type="range"
                  min="35"
                  max="95"
                  step="5"
                  value={wallpaperShade}
                  disabled={!appearance.data?.backgroundMediaId}
                  onChange={(e) => onWallpaperShadeChange(Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="appearance-preview">
              {appearance.data?.backgroundMediaId ? (
                <img
                  className="background-preview"
                  src={`/api/media/${appearance.data.backgroundMediaId}`}
                  alt="当前背景预览"
                />
              ) : (
                <div className="default-preview" aria-label="晨光农场默认外观" />
              )}
            </div>
          </div>
          <div className="settings-appearance-actions">
            <Button variant="secondary" disabled={busy} onClick={restoreDefaultAppearance}>
              恢复默认外观
            </Button>
          </div>
        </Card>
        <Card>
          <h2>工作台时区</h2>
          <p>截止日、今天和本周统计按此时区计算，访问端不会改变口径。</p>
          <div className="settings-row">
            <Field label="业务时区">
              <input
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="Asia/Shanghai"
              />
            </Field>
            <Button
              disabled={busy}
              onClick={() =>
                run(() => send('/settings/timezone', 'PUT', { timezone: zone }), '时区已保存')
              }
            >
              保存
            </Button>
          </div>
        </Card>
        <Card>
          <h2>局域网访问</h2>
          {access.isLoading ? (
            <Loading />
          ) : access.isError ? (
            <ErrorBox error={access.error} />
          ) : access.data?.local ? (
            <>
              <p>默认只允许本机连接。设置访问口令后重启服务，即可按下方地址从可信局域网访问。</p>
              <Field label="设备访问口令（至少 8 位）">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="设置新口令"
                />
              </Field>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={enableLan}
                  onChange={(e) => setEnableLan(e.target.checked)}
                />{' '}
                重启后允许局域网访问
              </label>
              <div className="settings-actions">
                <Button
                  disabled={busy || password.length < 8}
                  onClick={() =>
                    run(
                      () => send('/settings/access', 'PUT', { password, enableLan }),
                      '设置已保存，请重启服务使监听地址生效。',
                    )
                  }
                >
                  保存访问设置
                </Button>
              </div>
              <p>
                可用地址：
                {access.data?.addresses.map((a) => `http://${a}:4173`).join('、') ||
                  '未发现局域网地址'}
              </p>
              <p>局域网 HTTP 仅用于可信私有网络；口令不会加密传输。</p>
            </>
          ) : (
            <p>
              请在当前主机本机设置或修改访问口令。
              {access.data?.lanEnabled ? '局域网访问已启用。' : ''}
            </p>
          )}
        </Card>
        <Card>
          <h2>备份与恢复</h2>
          <p>
            备份使用 SQLite 一致性快照；服务运行时每日保留最近 7
            份自动备份。恢复只允许在主机本机操作，会先备份当前数据库并使其他页面重新载入。
          </p>
          {access.data?.local && (
            <Button
              disabled={busy}
              onClick={() => run(() => send('/backups', 'POST', {}), '手动备份已完成')}
            >
              立即备份
            </Button>
          )}
          {backups.isLoading ? (
            <Loading />
          ) : backups.isError ? (
            <ErrorBox error={backups.error} />
          ) : (
            <div className="backup-list">
              {backups.data?.length ? (
                backups.data.map((b) => (
                  <div className="backup-row" key={b.name}>
                    <div>
                      <strong>{b.name}</strong>
                      <small>{Math.round(b.size / 1024)} KB</small>
                    </div>
                    <div className="head-actions">
                      <a className="btn btn-secondary" href={`/api/backups/${b.name}/download`}>
                        下载
                      </a>
                      {access.data?.local && (
                        <Confirm
                          trigger={
                            <Button variant="ghost" disabled={busy}>
                              恢复
                            </Button>
                          }
                          title="恢复这份备份？"
                          description="当前数据库会先创建安全备份。恢复后所有打开的页面需要重新载入；确认已停止其他设备编辑。"
                          onConfirm={() => restore(b.name)}
                        />
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p>尚无备份</p>
              )}
            </div>
          )}
        </Card>
        <Card className="settings-technical">
          <details>
            <summary>技术信息与数据位置</summary>
            {meta.isLoading ? (
              <Loading />
            ) : meta.isError ? (
              <ErrorBox error={meta.error} />
            ) : (
              <>
                <p>
                  程序 v{meta.data?.appVersion} · 数据结构 {meta.data?.schemaVersion} ·{' '}
                  {meta.data?.os}/{meta.data?.arch} · Node {meta.data?.node}
                </p>
                <p>源码版本：{meta.data?.commit}</p>
                <p>数据目录：{meta.data?.dataDirectory || '请在主机本机查看'}</p>
              </>
            )}
            <p>替换程序目录不会自动复制或合并另一台电脑的数据。</p>
          </details>
        </Card>
      </div>
    </>
  );
}
