import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  statSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const target = process.argv[2];
const expected =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? 'macos-arm64'
    : process.platform === 'win32' && process.arch === 'x64'
      ? 'windows-x64'
      : '';
if (target !== expected)
  throw new Error(
    `只能在目标平台构建原生模块：需要 ${target}，当前 ${process.platform}-${process.arch}`,
  );
if (process.version !== 'v24.11.1') throw new Error('打包需要精确的 Node 24.11.1');
const root = process.cwd();
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const stageRoot = join(root, '.packstage');
const installRoot = join(stageRoot, 'install');
const name = `后来居上组管理后台-v${version}-${target}`;
const out = join(stageRoot, name);
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(installRoot, { recursive: true });
copyFileSync(join(root, 'package.json'), join(installRoot, 'package.json'));
copyFileSync(join(root, 'package-lock.json'), join(installRoot, 'package-lock.json'));
for (const path of ['apps/server', 'apps/web', 'packages/shared']) {
  const dest = join(installRoot, path);
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(root, path, 'package.json'), join(dest, 'package.json'));
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: installRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (install.status !== 0) throw new Error('生产依赖安装失败');
const requiredBuildFiles = ['dist/server/index.js', 'dist/web/index.html'];
for (const file of requiredBuildFiles) {
  const path = join(root, file);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0)
    throw new Error(`构建产物缺失：${file}`);
}
mkdirSync(join(out, 'runtime'), { recursive: true });
mkdirSync(join(out, 'app'), { recursive: true });
mkdirSync(join(out, 'licenses'), { recursive: true });
cpSync(join(root, 'licenses'), join(out, 'licenses'), { recursive: true });
copyFileSync(join(root, 'docs', '使用说明.md'), join(out, '使用说明.md'));
copyFileSync(
  process.execPath,
  join(out, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
);
if (process.platform !== 'win32') chmodSync(join(out, 'runtime', 'node'), 0o755);
cpSync(join(root, 'dist'), join(out, 'app', 'dist'), { recursive: true });
cpSync(join(root, 'drizzle'), join(out, 'app', 'drizzle'), { recursive: true });
mkdirSync(join(out, 'app', 'tools'), { recursive: true });
copyFileSync(join(root, 'scripts', 'stop.mjs'), join(out, 'app', 'tools', 'stop.mjs'));
const installedModules = join(installRoot, 'node_modules');
const bundledModules = join(out, 'app', 'node_modules');
cpSync(installedModules, bundledModules, {
  recursive: true,
  filter: (source) => {
    // npm workspaces are symlinks on Unix and junctions on Windows. The server
    // bundle already includes workspace code; neither those links nor .bin are
    // needed at runtime, and deleting copied junctions can remove their target.
    return basename(source) !== '.bin' && !lstatSync(source).isSymbolicLink();
  },
});
if (!existsSync(bundledModules)) throw new Error('复制后的生产依赖目录不存在');
for (const file of [
  ...requiredBuildFiles.map((x) => `app/${x}`),
  'app/drizzle/0005_task_updates.sql',
  'app/node_modules/better-sqlite3/package.json',
]) {
  const path = join(out, file);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0)
    throw new Error(`打包目录缺少文件：${file}`);
}
writeFileSync(join(out, 'app', 'package.json'), '{"private":true,"type":"module"}\n');
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: root,
  encoding: 'utf8',
});
const cleanCommit = commit.status === 0 && status.status === 0 && !status.stdout.trim();
writeFileSync(
  join(out, 'app', 'build-info.json'),
  JSON.stringify(
    {
      appVersion: version,
      schemaVersion: 5,
      commit: cleanCommit ? commit.stdout.trim() : 'local-uncommitted',
      os: process.platform,
      arch: process.arch,
      node: process.version,
    },
    null,
    2,
  ),
);
const licenses = [];
const collectLicenses = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === '.bin') continue;
    const file = join(dir, entry);
    if (!lstatSync(file).isDirectory()) continue;
    const manifest = join(file, 'package.json');
    if (existsSync(manifest)) {
      try {
        const p = JSON.parse(readFileSync(manifest, 'utf8'));
        licenses.push(
          `${p.name || entry}@${p.version || '?'}  ${typeof p.license === 'string' ? p.license : 'see package files'}`,
        );
      } catch {}
    }
    collectLicenses(file);
  }
};
collectLicenses(join(out, 'app', 'node_modules'));
writeFileSync(join(out, 'licenses', 'DEPENDENCIES.txt'), licenses.sort().join('\n') + '\n');
writeFileSync(
  join(out, 'licenses', 'NOTICE.txt'),
  'The bundled Node.js runtime and dependencies retain their upstream licenses. See DEPENDENCIES.txt and the license files in app/node_modules.\n',
);
if (target === 'macos-arm64') {
  writeFileSync(
    join(out, '启动.command'),
    '#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\ncd "$DIR/app" || exit 1\nAPP_PACKAGED=1 "$DIR/runtime/node" dist/server/index.js\n',
  );
  writeFileSync(
    join(out, '停止.command'),
    '#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\ncd "$DIR/app" || exit 1\n"$DIR/runtime/node" tools/stop.mjs\n',
  );
  chmodSync(join(out, '启动.command'), 0o755);
  chmodSync(join(out, '停止.command'), 0o755);
} else {
  writeFileSync(
    join(out, '启动.cmd'),
    '@echo off\r\npushd "%~dp0app"\r\nset APP_PACKAGED=1\r\n"%~dp0runtime\\node.exe" dist\\server\\index.js\r\nset "APP_EXIT=%ERRORLEVEL%"\r\npopd\r\nif not defined NO_PAUSE pause\r\nexit /b %APP_EXIT%\r\n',
  );
  writeFileSync(
    join(out, '停止.cmd'),
    '@echo off\r\npushd "%~dp0app"\r\n"%~dp0runtime\\node.exe" tools\\stop.mjs\r\nset "APP_EXIT=%ERRORLEVEL%"\r\npopd\r\nif not defined NO_PAUSE pause\r\nexit /b %APP_EXIT%\r\n',
  );
}
writeFileSync(
  join(out, '使用说明.txt'),
  `后来居上组管理后台 v${version} (${target})\n双击启动脚本，在浏览器访问 http://127.0.0.1:4173 。\n双击停止脚本仅停止本应用实例。请阅读同目录的「使用说明.md」，了解数据位置、备份恢复和局域网访问。\n本包独立运行；Mac 包不会自动连接 Windows 数据。\n`,
);
const native = spawnSync(
  join(out, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
  [
    '-e',
    'const D=require("better-sqlite3"); const db=new D(":memory:"); db.exec("create table x(a)"); db.prepare("insert into x values (?)").run(7); if(db.prepare("select a from x").get().a!==7)process.exit(1);',
  ],
  { cwd: join(out, 'app'), stdio: 'inherit' },
);
if (native.status !== 0) throw new Error('打包后的 SQLite 原生模块验证失败');
mkdirSync(join(root, 'release'), { recursive: true });
const archive = join(root, 'release', `${name}.zip`);
rmSync(archive, { force: true });
if (process.platform === 'win32') {
  const zip = spawnSync('tar.exe', ['-a', '-c', '-f', archive, '-C', stageRoot, name], {
    stdio: 'inherit',
  });
  if (zip.status !== 0) throw new Error('Windows ZIP 压缩失败');
} else {
  const zip = spawnSync('zip', ['-qry', archive, name], { cwd: stageRoot, stdio: 'inherit' });
  if (zip.status !== 0) throw new Error('压缩失败');
}
const contents = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tf', archive], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (contents.status !== 0) throw new Error('无法检查 ZIP 内容');
const archiveFiles = contents.stdout.split(/\r?\n/).map((x) => x.replaceAll('\\', '/'));
for (const file of [
  'app/build-info.json',
  ...requiredBuildFiles.map((x) => `app/${x}`),
  'app/drizzle/0005_task_updates.sql',
  'app/node_modules/better-sqlite3/package.json',
  `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
]) {
  if (!archiveFiles.some((entry) => entry.endsWith(`/${file}`)))
    throw new Error(`ZIP 缺少文件：${file}`);
}
const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
const sums = join(root, 'release', 'SHA256SUMS.txt');
const others = existsSync(sums)
  ? readFileSync(sums, 'utf8')
      .split('\n')
      .filter((x) => x && !x.endsWith(`  ${name}.zip`))
  : [];
writeFileSync(sums, [...others, `${hash}  ${name}.zip`].join('\n') + '\n');
console.log(`${archive}\nsha256 ${hash}`);
