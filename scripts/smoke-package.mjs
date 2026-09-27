import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';

if (!process.argv[2]) throw new Error('用法: node smoke-package.mjs <解压包目录>');
const packageRoot = resolve(process.argv[2]);
const runtime = join(packageRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const appRoot = join(packageRoot, 'app');
if (!existsSync(runtime)) throw new Error('包内运行时不存在');
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const buildInfo = JSON.parse(readFileSync(join(appRoot, 'build-info.json'), 'utf8'));
if (
  buildInfo.appVersion !== version ||
  buildInfo.os !== process.platform ||
  buildInfo.arch !== process.arch ||
  buildInfo.node !== process.version ||
  basename(packageRoot) !==
    `后来居上组管理后台-v${version}-${process.platform === 'win32' ? 'windows-x64' : 'macos-arm64'}`
)
  throw new Error('解压包版本、平台或构建信息不匹配');
const data = mkdtempSync(join(tmpdir(), 'workbench-package-smoke-'));
const port = await new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const script = (action) =>
  process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/c', `${action}.cmd`] }
    : { command: '/bin/sh', args: [join(packageRoot, `${action}.command`)] };
function startScript(action) {
  const { command, args } = script(action);
  const child = spawn(command, args, {
    cwd: packageRoot,
    env: {
      ...process.env,
      DATA_DIR: data,
      PORT: String(port),
      HOST: '127.0.0.1',
      NO_BROWSER: '1',
      NO_PAUSE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  return child;
}
async function run() {
  const child = startScript('启动');
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`服务提前退出: ${output}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`服务未启动: ${output}`);
}
async function stop(child) {
  const stopper = startScript('停止');
  let output = '';
  stopper.stdout.on('data', (d) => (output += d));
  stopper.stderr.on('data', (d) => (output += d));
  await new Promise((resolve, reject) =>
    stopper.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`停止脚本失败: ${output}`)),
    ),
  );
  await new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('服务无法停止')), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
let child;
try {
  child = await run();
  const write = await fetch(`${base}/api/groups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '解压包测试小组' }),
  });
  if (write.status !== 201) throw new Error(`写入失败 ${write.status}`);
  const meta = await (await fetch(`${base}/api/meta`)).json();
  if (
    meta.node !== process.version ||
    meta.arch !== process.arch ||
    meta.os !== process.platform ||
    meta.appVersion !== version ||
    meta.schemaVersion !== buildInfo.schemaVersion ||
    meta.commit !== buildInfo.commit
  )
    throw new Error('包内版本或架构信息不匹配');
  const backup = await fetch(`${base}/api/backups`, { method: 'POST' });
  if (backup.status !== 201) throw new Error(`备份失败 ${backup.status}`);
  const snapshot = await fetch(`${base}/api/backups/${(await backup.json()).name}/download`);
  const bytes = new Uint8Array(await snapshot.arrayBuffer());
  if (
    snapshot.status !== 200 ||
    new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\u0000'
  )
    throw new Error('备份下载不是有效 SQLite 文件');
  const page = await fetch(`${base}/tasks`);
  if (!page.ok || !(await page.text()).includes('后来居上组管理后台'))
    throw new Error('前端路由刷新失败');
  for (const asset of ['banner.webp', 'sprout.png', 'sidebar-garden.png', 'wood-strip.webp']) {
    const response = await fetch(`${base}/assets/farm/${asset}`);
    if (!response.ok || (await response.arrayBuffer()).byteLength < 1000)
      throw new Error(`本地农场素材缺失：${asset}`);
  }
  await stop(child);
  child = undefined;
  child = await run();
  const records = await (await fetch(`${base}/api/groups`)).json();
  if (!records.some((x) => x.name === '解压包测试小组')) throw new Error('重启后记录丢失');
  await stop(child);
  child = undefined;
  console.log(
    'PASS: 顶层启动停止脚本、包内运行时、SQLite 写入、备份下载、停止重启保留、前端路由及本地农场素材',
  );
} finally {
  if (child && child.exitCode === null) {
    try {
      await stop(child);
    } catch {
      child.kill();
    }
  }
  rmSync(data, { recursive: true, force: true });
}
