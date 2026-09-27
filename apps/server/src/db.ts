import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === 'win32')
    return join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'AIShortDramaWorkbench',
      'data',
    );
  return join(homedir(), 'Library', 'Application Support', 'AIShortDramaWorkbench', 'data');
}
export function openDatabase(migrationDir = join(process.cwd(), 'drizzle'), directory = dataDir()) {
  mkdirSync(directory, { recursive: true });
  const db = new Database(join(directory, 'workbench.db'));
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const files = readdirSync(migrationDir)
    .filter((x) => /^\d+.*\.sql$/.test(x))
    .sort();
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (x) => x.name,
    ),
  );
  if ([...applied].some((x) => !files.includes(x)))
    throw new Error('数据库版本高于当前程序，已拒绝写入。');
  const pending = files.filter((file) => !applied.has(file));
  if (pending.length && applied.size) {
    let backup = join(directory, `pre-migration-${Date.now()}.db`);
    while (existsSync(backup))
      backup = join(
        directory,
        `pre-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
      );
    db.prepare('VACUUM INTO ?').run(backup);
  }
  for (const file of pending) {
    db.transaction(() => {
      db.exec(readFileSync(join(migrationDir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(file, new Date().toISOString());
    })();
  }
  return db;
}
