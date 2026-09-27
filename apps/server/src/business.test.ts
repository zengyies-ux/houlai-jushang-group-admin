import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';

describe('团队与任务闭环', () => {
  it('组长换组、任务转交保留历史；提交验收有版本冲突保护', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-business-'));
    const db = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const app = createApp(db);
    const send = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: any) =>
      await app.inject({ method, url, payload });
    try {
      const g1 = (await send('POST', '/api/groups', { name: '制作一组' })).json();
      const g2 = (await send('POST', '/api/groups', { name: '制作二组' })).json();
      const ungrouped = (
        await send('POST', '/api/members', { name: '待分组', joinedAt: '2026-01-01' })
      ).json();
      expect(ungrouped.groupId).toBeNull();
      const assigned = (
        await send('PATCH', `/api/members/${ungrouped.id}`, { groupId: g1.id })
      ).json();
      expect(assigned.groupId).toBe(g1.id);
      expect(
        (await send('GET', `/api/members/${ungrouped.id}`))
          .json()
          .history.map((h: any) => h.group_name_snapshot),
      ).toEqual(['制作一组', null]);
      const m1 = (
        await send('POST', '/api/members', {
          name: '小青',
          position: '剪辑',
          groupId: g1.id,
          joinedAt: '2026-01-01',
        })
      ).json();
      const m2 = (
        await send('POST', '/api/members', {
          name: '小蓝',
          position: '配音',
          groupId: g2.id,
          joinedAt: '2026-01-01',
        })
      ).json();
      expect(
        (await send('PATCH', `/api/groups/${g1.id}`, { leaderId: m1.id })).json().leaderId,
      ).toBe(m1.id);
      const move = await send('PATCH', `/api/members/${m1.id}`, { groupId: g2.id });
      expect(move.statusCode).toBe(200);
      expect(
        (await send('PATCH', `/api/members/${m1.id}`, { status: 'left', leftAt: '2025-01-01' }))
          .statusCode,
      ).toBe(400);
      expect(
        (await send('GET', '/api/groups')).json().find((g: any) => g.id === g1.id).leaderId,
      ).toBeNull();
      expect((await send('GET', `/api/members/${m1.id}`)).json().history).toHaveLength(2);
      const created = await send('POST', '/api/tasks', {
        title: '第一集',
        ownerId: m1.id,
        collaboratorIds: [m2.id],
        groupId: g1.id,
        deadline: '2026-12-31',
      });
      expect(created.statusCode).toBe(201);
      let task = created.json();
      expect(task.status).toBe('todo');
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'start',
          version: task.version,
        })
      ).json();
      const duplicate = await send('POST', `/api/tasks/${task.id}/transition`, {
        action: 'start',
        version: task.version - 1,
      });
      expect(duplicate.statusCode).toBe(409);
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'submit',
          version: task.version,
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'reject',
          version: task.version,
          comment: '请调整画面',
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'submit',
          version: task.version,
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'approve',
          version: task.version,
        })
      ).json();
      expect(task.status).toBe('completed');
      expect(task.events.map((e: any) => e.type)).toEqual([
        'created',
        'started',
        'submitted',
        'rejected',
        'submitted',
        'approved',
      ]);
      task = (
        await send('POST', `/api/tasks/${task.id}/transition`, {
          action: 'undo_approve',
          version: task.version,
        })
      ).json();
      expect(task.completed_at).toBeNull();
      task = (
        await send('PATCH', `/api/tasks/${task.id}`, {
          version: task.version,
          collaboratorIds: [],
        })
      ).json();
      expect(task.collaborators).toHaveLength(0);
      expect(task.events.at(-1).type).toBe('participants_changed');
      task = (
        await send('PATCH', `/api/tasks/${task.id}`, {
          version: task.version,
          ownerId: m2.id,
          collaboratorIds: [],
        })
      ).json();
      expect(task.owner_id).toBe(m2.id);
      expect(
        (await send('GET', `/api/members/${m1.id}`))
          .json()
          .tasks.some((t: any) => t.id === task.id),
      ).toBe(true);
      const overview = (await send('GET', '/api/overview')).json();
      expect(overview.members.find((m: any) => m.id === m1.id).current_tasks).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
