import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import DatabaseClass from 'better-sqlite3';
import { join, dirname, basename } from 'node:path';
import {
  mkdirSync,
  readdirSync,
  renameSync,
  copyFileSync,
  existsSync,
  unlinkSync,
  readFileSync,
  statSync,
  createReadStream,
} from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { isLocal } from './auth';
import { parsed, Problem, now } from './http';
import { openDatabase } from './db';

let epoch = randomUUID();
export const dataEpoch = () => epoch;
export function registerMaintenance(
  app: FastifyInstance,
  db: Database.Database,
  switchDatabase?: (next: Database.Database) => void,
) {
  const directory = dirname(db.name),
    backupDir = join(directory, 'backups'),
    databaseFile = join(directory, 'workbench.db');
  mkdirSync(backupDir, { recursive: true });
  let restoring = false;
  const onlyLocal = (req: FastifyRequest) => {
    if (!isLocal(req)) throw new Problem(403, '请在主机本机操作');
  };
  const known = (name: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{6}(?:-[a-f0-9]{8})?-(manual|daily|pre-restore)\.db$/.test(name))
      throw new Problem(400, '备份名称无效');
    const path = join(backupDir, name);
    if (!existsSync(path)) throw new Problem(404, '备份不存在');
    return path;
  };
  const list = () =>
    readdirSync(backupDir)
      .filter((x) => /^\d{4}-.*\.db$/.test(x))
      .sort()
      .reverse()
      .map((name) => ({ name, size: statSync(join(backupDir, name)).size }));
  const backup = async (kind: 'manual' | 'daily' | 'pre-restore') => {
    const name = `${new Date()
      .toISOString()
      .replaceAll(':', '')
      .replace(/\.\d+Z$/, '')}-${randomBytes(4).toString('hex')}-${kind}.db`;
    const path = join(backupDir, name),
      tmp = `${path}.partial`;
    try {
      await db.backup(tmp);
      renameSync(tmp, path);
      return { name, size: statSync(path).size };
    } catch (e) {
      if (existsSync(tmp)) unlinkSync(tmp);
      throw e;
    }
  };
  app.addHook('onRequest', async (req, reply) => {
    if (restoring && !req.url.startsWith('/api/backups/restore'))
      return reply.code(503).send({ error: '正在恢复数据库，请稍后重试' });
  });
  app.get('/api/meta', async (req) => {
    const root = process.env.APP_ROOT || process.cwd();
    let build: any = {
      appVersion: '0.3.2',
      schemaVersion: 5,
      commit: 'local',
      os: process.platform,
      arch: process.arch,
      node: process.version,
    };
    try {
      build = { ...build, ...JSON.parse(readFileSync(join(root, 'build-info.json'), 'utf8')) };
    } catch {}
    return { ...build, dataDirectory: isLocal(req) ? directory : null, epoch };
  });
  app.get('/api/backups', async () => list());
  app.post('/api/backups', async (req, reply) => {
    onlyLocal(req);
    return reply.code(201).send(await backup('manual'));
  });
  app.get<{ Params: { name: string } }>('/api/backups/:name/download', async (req, reply) => {
    const path = known(req.params.name);
    reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${basename(path)}"`);
    return reply.send(createReadStream(path));
  });
  app.post('/api/backups/restore', async (req, reply) => {
    onlyLocal(req);
    if (!switchDatabase) throw new Problem(501, '当前运行模式不支持恢复');
    const x = parsed(
      z.object({ name: z.string(), confirm: z.literal('RESTORE') }),
      req.body,
      reply,
    );
    if (!x) return;
    const candidate = known(x.name);
    const check = new DatabaseClass(candidate, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok')
        throw new Problem(400, '备份完整性校验失败');
      const expected = (
        db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]
      ).map((x) => x.name);
      const actual = (
        check.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as {
          name: string;
        }[]
      ).map((x) => x.name);
      // An older snapshot can be restored when its migrations are an exact prefix.
      // openDatabase applies only the missing migrations after the safety backup below.
      if (
        actual.length === 0 ||
        actual.length > expected.length ||
        JSON.stringify(expected.slice(0, actual.length)) !== JSON.stringify(actual)
      )
        throw new Problem(400, '备份数据库版本与当前程序不兼容');
    } finally {
      check.close();
    }
    restoring = true;
    let oldCopy: string | undefined;
    let closed = false;
    let next: Database.Database | undefined;
    try {
      const safety = await backup('pre-restore');
      oldCopy = join(backupDir, safety.name);
      db.close();
      closed = true;
      for (const suffix of ['-wal', '-shm'])
        if (existsSync(databaseFile + suffix)) unlinkSync(databaseFile + suffix);
      copyFileSync(candidate, databaseFile);
      next = openDatabase(join(process.env.APP_ROOT || process.cwd(), 'drizzle'), directory);
      next.prepare('DELETE FROM sessions').run();
      switchDatabase(next);
      next = undefined;
      epoch = randomUUID();
      return { ok: true, reloadRequired: true, preRestoreBackup: safety.name, epoch };
    } catch (error) {
      next?.close();
      if (oldCopy && closed) {
        for (const suffix of ['-wal', '-shm'])
          if (existsSync(databaseFile + suffix)) unlinkSync(databaseFile + suffix);
        copyFileSync(oldCopy, databaseFile);
        const recovered = openDatabase(
          join(process.env.APP_ROOT || process.cwd(), 'drizzle'),
          directory,
        );
        switchDatabase(recovered);
      }
      throw error;
    } finally {
      restoring = false;
    }
  });
  return { backup, list };
}
