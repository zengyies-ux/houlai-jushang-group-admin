import { describe, it, expect } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from './db';
import { createApp } from './app';

describe('备份恢复与局域网保护', () => {
  it('一致性备份可恢复，旧会话撤销，远程写入需要来源校验', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-restore-'));
    let current = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const db = new Proxy(current, {
      get(_target, key) {
        const v = (current as any)[key];
        return typeof v === 'function' ? v.bind(current) : v;
      },
    }) as typeof current;
    const app = createApp(db, join(process.cwd(), 'dist/web'), (next) => {
      current = next;
    });
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/groups',
        payload: { name: '备份前' },
      });
      expect(first.statusCode).toBe(201);
      const saved = await app.inject({ method: 'POST', url: '/api/backups' });
      expect(saved.statusCode).toBe(201);
      const name = saved.json().name;
      expect(
        (await app.inject({ method: 'POST', url: '/api/groups', payload: { name: '备份后' } }))
          .statusCode,
      ).toBe(201);
      const restored = await app.inject({
        method: 'POST',
        url: '/api/backups/restore',
        payload: { name, confirm: 'RESTORE' },
      });
      expect(restored.statusCode).toBe(200);
      expect((await app.inject('/api/groups')).json().map((x: any) => x.name)).toEqual(['备份前']);
      const access = await app.inject({
        method: 'PUT',
        url: '/api/settings/access',
        payload: { password: 'long-password-123', enableLan: true },
      });
      expect(access.statusCode).toBe(200);
      const remote = { remoteAddress: '192.168.1.50', headers: { host: 'localhost:4173' } } as any;
      expect((await app.inject({ ...remote, url: '/api/groups' })).statusCode).toBe(401);
      const login = await app.inject({
        ...remote,
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'long-password-123' },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      expect(
        (
          await app.inject({
            ...remote,
            url: '/api/groups',
            headers: { host: 'localhost:4173', cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            ...remote,
            method: 'POST',
            url: '/api/groups',
            headers: { host: 'localhost:4173', cookie },
            payload: { name: 'blocked' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            ...remote,
            method: 'POST',
            url: '/api/groups',
            headers: { host: 'localhost:4173', cookie, origin: 'http://localhost:4173' },
            payload: { name: 'remote' },
          })
        ).statusCode,
      ).toBe(201);
    } finally {
      await app.close();
      current.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('V0.2 备份可安全恢复到 V0.3，并保留旧媒体与历史', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-restore-v02-'));
    const oldMigrations = join(dir, 'old-migrations');
    const backupDir = join(dir, 'backups');
    mkdirSync(oldMigrations);
    mkdirSync(backupDir);
    for (const file of [
      '0001_initial.sql',
      '0002_business.sql',
      '0003_security.sql',
      '0004_media.sql',
    ])
      copyFileSync(join(process.cwd(), 'drizzle', file), join(oldMigrations, file));
    const oldBackupName = '2026-09-26T120000-a1b2c3d4-manual.db';
    const old = openDatabase(oldMigrations, dir);
    const stamp = new Date().toISOString();
    try {
      old
        .prepare('INSERT INTO media (id,kind,mime,bytes,created_at) VALUES (?,?,?,?,?)')
        .run('old-avatar', 'avatar', 'image/png', Buffer.from('old-image'), stamp);
      old
        .prepare(
          'INSERT INTO members (id,name,position,avatar_id,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('old-member', '旧成员', '', 'old-avatar', 'active', '2026-01-01', stamp, stamp);
      old
        .prepare('INSERT INTO member_group_history (id,member_id,started_at) VALUES (?,?,?)')
        .run('old-history', 'old-member', stamp);
      old
        .prepare(
          'INSERT INTO tasks (id,title,owner_id,status,deadline,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          'old-task',
          '旧待确认任务',
          'old-member',
          'pending_review',
          '2026-12-31',
          3,
          stamp,
          stamp,
        );
      old
        .prepare(
          'INSERT INTO task_events (id,task_id,type,from_status,to_status,payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run('old-event', 'old-task', 'submitted', 'in_progress', 'pending_review', '{}', stamp);
      await old.backup(join(backupDir, oldBackupName));
    } finally {
      old.close();
    }
    let current = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const db = new Proxy(current, {
      get(_target, key) {
        const value = (current as any)[key];
        return typeof value === 'function' ? value.bind(current) : value;
      },
    }) as typeof current;
    const app = createApp(db, join(process.cwd(), 'dist/web'), (next) => {
      current = next;
    });
    try {
      const added = await app.inject({
        method: 'POST',
        url: '/api/groups',
        payload: { name: '升级后临时小组' },
      });
      expect(added.statusCode).toBe(201);
      const restored = await app.inject({
        method: 'POST',
        url: '/api/backups/restore',
        payload: { name: oldBackupName, confirm: 'RESTORE' },
      });
      expect(restored.statusCode).toBe(200);
      const safetyName = restored.json().preRestoreBackup;
      expect(existsSync(join(backupDir, safetyName))).toBe(true);
      const safety = new Database(join(backupDir, safetyName), { readonly: true });
      try {
        expect(
          (
            safety
              .prepare("SELECT count(*) AS n FROM groups WHERE name='升级后临时小组'")
              .get() as any
          ).n,
        ).toBe(1);
      } finally {
        safety.close();
      }
      expect((await app.inject('/api/groups')).json()).toEqual([]);
      expect(
        current
          .prepare('SELECT status,version,risk_flag,latest_update FROM tasks WHERE id=?')
          .get('old-task'),
      ).toEqual({ status: 'pending_review', version: 3, risk_flag: 0, latest_update: null });
      expect((current.prepare('SELECT count(*) AS n FROM media').get() as any).n).toBe(1);
      expect(
        (current.prepare('SELECT count(*) AS n FROM member_group_history').get() as any).n,
      ).toBe(1);
      expect((current.prepare('SELECT count(*) AS n FROM task_events').get() as any).n).toBe(1);
      expect(
        (
          current
            .prepare(
              "SELECT count(*) AS n FROM schema_migrations WHERE name='0005_task_updates.sql'",
            )
            .get() as any
        ).n,
      ).toBe(1);
      expect(readdirSync(dir).some((name) => name.startsWith('pre-migration-'))).toBe(true);
    } finally {
      await app.close();
      current.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
