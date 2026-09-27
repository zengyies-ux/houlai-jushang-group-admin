import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const directory =
  process.env.DATA_DIR ||
  (process.platform === 'win32'
    ? join(
        process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
        'AIShortDramaWorkbench',
        'data',
      )
    : join(homedir(), 'Library', 'Application Support', 'AIShortDramaWorkbench', 'data'));
const file = join(directory, 'run.json');
if (!existsSync(file)) {
  console.log('本应用未在运行。');
  process.exit(0);
}
try {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${run.port}/api/control/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${run.token}` },
  });
  if (!response.ok) throw new Error(`停止请求被拒绝 (${response.status})`);
  console.log('已请求停止本应用。');
} catch (e) {
  console.error('无法确认当前应用实例，未停止其他进程：', e.message);
  process.exitCode = 1;
}
