import { openDatabase } from './db';
import { createApp } from './app';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isLocal } from './auth';

const root = process.env.APP_ROOT || process.cwd();
let current = openDatabase(join(root, 'drizzle'));
const db = new Proxy(current, {
  get(_target, key) {
    const value = (current as any)[key];
    return typeof value === 'function' ? value.bind(current) : value;
  },
}) as typeof current;
const app = createApp(db, join(root, 'dist/web'), (next) => {
  current = next;
});
const port = Number(process.env.PORT || 4173);
const lan =
  (
    db.prepare("SELECT value FROM settings WHERE key='lan_enabled'").get() as
      { value: string } | undefined
  )?.value === '1';
const passwordSet = !!db.prepare("SELECT value FROM settings WHERE key='access_hash'").get();
const host = process.env.HOST || (lan && passwordSet ? '0.0.0.0' : '127.0.0.1');
if (host !== '127.0.0.1' && host !== '::1' && !passwordSet) {
  console.error('局域网监听前必须在本机设置访问口令。');
  process.exit(1);
}
const token = randomBytes(24).toString('hex'),
  instanceId = randomUUID(),
  runFile = join(dirname(db.name), 'run.json');
app.get('/api/control/identity', async (req, reply) => {
  if (!isLocal(req)) return reply.code(403).send({ error: '仅限本机' });
  return { instanceId };
});
const url = `http://127.0.0.1:${port}`;
const openBrowser = () => {
  if (process.env.APP_PACKAGED !== '1' || process.env.NO_BROWSER === '1') return;
  const child =
    process.platform === 'win32'
      ? spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
      : spawn('open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => console.error('无法自动打开浏览器，请手动访问', url, e.message));
  child.unref();
};
app.post('/api/control/stop', async (req, reply) => {
  if (!isLocal(req) || req.headers.authorization !== `Bearer ${token}`)
    return reply.code(403).send({ error: '停止请求无效' });
  setTimeout(() => void close(), 100);
  return { ok: true };
});
let started = false;
try {
  await app.listen({ port, host });
  started = true;
  writeFileSync(
    runFile,
    JSON.stringify({
      pid: process.pid,
      port,
      token,
      instanceId,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(`后来居上组管理后台: ${url}`);
  openBrowser();
} catch (error) {
  console.error('启动失败，端口可能被占用：', error);
  if (existsSync(runFile)) {
    try {
      const old = JSON.parse(readFileSync(runFile, 'utf8'));
      const res = await fetch(`http://127.0.0.1:${old.port}/api/control/identity`);
      if (res.ok && (await res.json()).instanceId === old.instanceId) {
        console.log('本应用已在运行：', `http://127.0.0.1:${old.port}`);
        openBrowser();
        process.exitCode = 0;
      } else {
        console.error('端口已被其他程序占用，请关闭该程序或设置不同 PORT。');
        process.exitCode = 1;
      }
    } catch {
      process.exitCode = 1;
    }
  } else process.exitCode = 1;
  db.close();
}
const daily = async () => {
  const m = (app as any).maintenance;
  const today = new Date().toISOString().slice(0, 10);
  if (!m.list().some((x: any) => x.name.startsWith(today) && x.name.endsWith('-daily.db'))) {
    try {
      await m.backup('daily');
      const dailyFiles = m.list().filter((x: any) => x.name.endsWith('-daily.db'));
      for (const extra of dailyFiles.slice(7))
        unlinkSync(join(dirname(db.name), 'backups', extra.name));
    } catch (e) {
      console.error('每日备份失败：', e);
    }
  }
};
if (started) {
  void daily();
  const timer = setInterval(() => void daily(), 60 * 60 * 1000);
  timer.unref();
}
const close = async () => {
  if (!started) return;
  started = false;
  try {
    if (existsSync(runFile) && JSON.parse(readFileSync(runFile, 'utf8')).token === token)
      unlinkSync(runFile);
  } catch {}
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
