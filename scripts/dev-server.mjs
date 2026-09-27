import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const defaultDirectory =
  process.platform === 'win32'
    ? join(
        process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
        'AIShortDramaWorkbench',
        'dev-data',
      )
    : join(homedir(), 'Library', 'Application Support', 'AIShortDramaWorkbench', 'dev-data');
const directory = process.env.DATA_DIR || defaultDirectory;
const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
console.log(`开发测试数据目录: ${directory}`);
const child = spawn(executable, ['watch', 'apps/server/src/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, DATA_DIR: directory, NO_BROWSER: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
