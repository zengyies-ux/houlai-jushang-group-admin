import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from './db';
import { createApp } from './app';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/+pUAAAAASUVORK5CYII=';

describe('头像、背景与旧库升级', () => {
  it('从旧结构升级保留成员，并将图片放入可备份数据库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-media-'));
    const oldMigrations = join(dir, 'old-migrations');
    mkdirSync(oldMigrations);
    for (const file of ['0001_initial.sql', '0002_business.sql', '0003_security.sql'])
      copyFileSync(join(process.cwd(), 'drizzle', file), join(oldMigrations, file));
    const old = openDatabase(oldMigrations, dir);
    const stamp = new Date().toISOString();
    old
      .prepare(
        'INSERT INTO members (id,name,position,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run('legacy-member', '原有成员', '', 'active', '2026-01-01', stamp, stamp);
    old.close();
    const db = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const app = createApp(db);
    try {
      expect(readdirSync(dir).some((name) => name.startsWith('pre-migration-'))).toBe(true);
      expect(
        db.prepare('SELECT name,avatar_id FROM members WHERE id=?').get('legacy-member') as any,
      ).toEqual({ name: '原有成员', avatar_id: null });
      const background = await app.inject({
        method: 'PUT',
        url: '/api/appearance/background',
        payload: { image },
      });
      expect(background.statusCode).toBe(200);
      const backgroundId = background.json().backgroundMediaId;
      const avatar = await app.inject({
        method: 'PUT',
        url: '/api/members/legacy-member/avatar',
        payload: { image },
      });
      expect(avatar.statusCode).toBe(200);
      const avatarId = avatar.json().avatarId;
      expect(
        (await app.inject('/api/overview'))
          .json()
          .members.find((m: any) => m.id === 'legacy-member').avatarId,
      ).toBe(avatarId);
      expect((await app.inject('/api/appearance')).json().backgroundMediaId).toBe(backgroundId);
      const file = await app.inject(`/api/media/${avatarId}`);
      expect(file.headers['content-type']).toContain('image/png');
      expect(file.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const backup = (await app.inject({ method: 'POST', url: '/api/backups' })).json();
      const snapshot = new Database(join(dir, 'backups', backup.name), { readonly: true });
      expect((snapshot.prepare('SELECT count(*) AS n FROM media').get() as any).n).toBe(2);
      snapshot.close();
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/api/appearance/background',
            payload: { image: 'data:image/png;base64,QUJD' },
          })
        ).statusCode,
      ).toBe(400);
      await app.inject({ method: 'DELETE', url: '/api/members/legacy-member/avatar' });
      expect((await app.inject(`/api/media/${avatarId}`)).statusCode).toBe(404);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
