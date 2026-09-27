import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';
import { addDays } from '../../../packages/shared/src/rules';

describe('V0.3 任务命令与旧库迁移', () => {
  it('直接完成与撤销使用快照；后续修改阻止旧撤销', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-v03-command-'));
    const db = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const app = createApp(db);
    const send = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: any) =>
      app.inject({ method, url, payload });
    try {
      const member = (
        await send('POST', '/api/members', { name: '小麦', joinedAt: '2026-01-01' })
      ).json();
      let task = (
        await send('POST', '/api/tasks', {
          title: '一键完成',
          ownerId: member.id,
          deadline: '2026-12-31',
          progress: 42,
        })
      ).json();
      task = (
        await send('PATCH', `/api/tasks/${task.id}/risk`, {
          version: task.version,
          riskFlag: true,
          riskNote: '素材可能迟到',
        })
      ).json();
      expect(task.risk_flag).toBe(1);
      const beforeVersion = task.version;
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'complete',
          version: task.version,
        })
      ).json();
      expect(task).toMatchObject({
        status: 'completed',
        progress: 100,
        risk_flag: 0,
        risk_note: null,
      });
      expect(task.completed_at).toBeTruthy();
      expect(task.events.filter((e: any) => e.type === 'completed')).toHaveLength(1);
      expect(
        (
          await send('POST', `/api/tasks/${task.id}/transition`, {
            action: 'undo_approve',
            version: task.version,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await send('POST', `/api/tasks/${task.id}/command`, {
            action: 'complete',
            version: beforeVersion,
          })
        ).statusCode,
      ).toBe(409);
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'undo_complete',
          version: task.version,
        })
      ).json();
      expect(task).toMatchObject({
        status: 'todo',
        progress: 42,
        completed_at: null,
        risk_flag: 1,
        risk_note: '素材可能迟到',
      });
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'complete',
          version: task.version,
        })
      ).json();
      task = (
        await send('PATCH', `/api/tasks/${task.id}/update`, {
          version: task.version,
          latestUpdate: '已整理镜头清单',
        })
      ).json();
      expect(task.latest_update_at).toBeTruthy();
      const rejected = await send('POST', `/api/tasks/${task.id}/command`, {
        action: 'undo_complete',
        version: task.version,
      });
      expect(rejected.statusCode).toBe(409);
      expect((await send('GET', `/api/tasks/${task.id}`)).json().status).toBe('completed');
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'reopen',
          version: task.version,
        })
      ).json();
      expect(task).toMatchObject({
        status: 'in_progress',
        progress: null,
        completed_at: null,
        risk_flag: 0,
        risk_note: null,
      });
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('待确认无需伪造提交，进展与风险写事件并保护版本', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-v03-pending-'));
    const db = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const app = createApp(db);
    const send = async (method: 'POST' | 'PATCH', url: string, payload: any) =>
      app.inject({ method, url, payload });
    try {
      const member = (
        await send('POST', '/api/members', { name: '小田', joinedAt: '2026-01-01' })
      ).json();
      let task = (
        await send('POST', '/api/tasks', {
          title: '分镜',
          ownerId: member.id,
          deadline: '2026-12-31',
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'mark_pending',
          version: task.version,
        })
      ).json();
      expect(task).toMatchObject({ status: 'pending_review', submitted_at: null });
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'resume',
          version: task.version,
          comment: '继续调整',
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'reset_to_todo',
          version: task.version,
        })
      ).json();
      expect(task.status).toBe('todo');
      task = (
        await send('PATCH', `/api/tasks/${task.id}/update`, {
          version: task.version,
          latestUpdate: '  等待分镜反馈  ',
        })
      ).json();
      expect(task.latest_update).toBe('等待分镜反馈');
      expect(
        (
          await send('PATCH', `/api/tasks/${task.id}/risk`, {
            version: task.version - 1,
            riskFlag: true,
          })
        ).statusCode,
      ).toBe(409);
      task = (
        await send('PATCH', `/api/tasks/${task.id}/risk`, {
          version: task.version,
          riskFlag: true,
          riskNote: '等待外部配音',
        })
      ).json();
      expect(task.events.at(-1).type).toBe('risk_marked');
      task = (
        await send('PATCH', `/api/tasks/${task.id}/risk`, {
          version: task.version,
          riskFlag: false,
        })
      ).json();
      expect(task).toMatchObject({ risk_flag: 0, risk_note: null });
      expect(task.events.at(-1).type).toBe('risk_cleared');
      expect(
        (
          await send('PATCH', `/api/tasks/${task.id}/update`, {
            version: task.version,
            latestUpdate: '字'.repeat(281),
          })
        ).statusCode,
      ).toBe(400);
      let legacy = (
        await send('POST', '/api/tasks', {
          title: '旧待验收任务',
          ownerId: member.id,
          deadline: '2026-12-31',
        })
      ).json();
      legacy = (
        await send('POST', `/api/tasks/${legacy.id}/transition`, {
          action: 'start',
          version: legacy.version,
        })
      ).json();
      legacy = (
        await send('POST', `/api/tasks/${legacy.id}/transition`, {
          action: 'submit',
          version: legacy.version,
        })
      ).json();
      const oldSubmittedAt = legacy.submitted_at;
      legacy = (
        await send('POST', `/api/tasks/${legacy.id}/command`, {
          action: 'complete',
          version: legacy.version,
        })
      ).json();
      expect(legacy).toMatchObject({ status: 'completed', submitted_at: oldSubmittedAt });
      expect(legacy.events.filter((e: any) => e.type === 'completed')).toHaveLength(1);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('0004 升级时保留成员、媒体、任务、历史并先备份', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-v03-migration-'));
    const oldMigrations = join(dir, 'old-migrations');
    mkdirSync(oldMigrations);
    for (const file of [
      '0001_initial.sql',
      '0002_business.sql',
      '0003_security.sql',
      '0004_media.sql',
    ])
      copyFileSync(join(process.cwd(), 'drizzle', file), join(oldMigrations, file));
    const old = openDatabase(oldMigrations, dir);
    const stamp = new Date().toISOString();
    try {
      old
        .prepare('INSERT INTO media (id,kind,mime,bytes,created_at) VALUES (?,?,?,?,?)')
        .run('old-avatar', 'avatar', 'image/png', Buffer.from('old-png'), stamp);
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
        .run('old-task', '旧任务', 'old-member', 'pending_review', '2026-12-31', 3, stamp, stamp);
      old
        .prepare(
          'INSERT INTO task_events (id,task_id,type,from_status,to_status,payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run('old-event', 'old-task', 'submitted', 'in_progress', 'pending_review', '{}', stamp);
    } finally {
      old.close();
    }
    const upgraded = openDatabase(join(process.cwd(), 'drizzle'), dir);
    try {
      expect(readdirSync(dir).some((name) => name.startsWith('pre-migration-'))).toBe(true);
      expect(
        upgraded.prepare('SELECT name,avatar_id FROM members WHERE id=?').get('old-member'),
      ).toEqual({
        name: '旧成员',
        avatar_id: 'old-avatar',
      });
      expect((upgraded.prepare('SELECT count(*) AS n FROM media').get() as any).n).toBe(1);
      expect(
        (upgraded.prepare('SELECT count(*) AS n FROM member_group_history').get() as any).n,
      ).toBe(1);
      expect((upgraded.prepare('SELECT count(*) AS n FROM task_events').get() as any).n).toBe(1);
      expect(
        upgraded
          .prepare('SELECT status,version,risk_flag,latest_update FROM tasks WHERE id=?')
          .get('old-task'),
      ).toEqual({
        status: 'pending_review',
        version: 3,
        risk_flag: 0,
        latest_update: null,
      });
    } finally {
      upgraded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
