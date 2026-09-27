import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';

describe('任务中途调整参与人员', () => {
  it('加入、换负责人、退出均记录快照，并更新当前任务与历史', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-participants-'));
    const db = openDatabase(join(process.cwd(), 'drizzle'), dir);
    const app = createApp(db);
    const send = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: any) =>
      app.inject({ method, url, payload });
    try {
      const members = await Promise.all(
        ['原负责人', '原协作者', '中途加入'].map(async (name) =>
          (await send('POST', '/api/members', { name, joinedAt: '2026-01-01' })).json(),
        ),
      );
      const [first, second, newcomer] = members;
      let task = (
        await send('POST', '/api/tasks', {
          title: '制作第一集',
          ownerId: first.id,
          collaboratorIds: [second.id],
          deadline: '2026-12-31',
        })
      ).json();
      task = (
        await send('POST', `/api/tasks/${task.id}/command`, {
          action: 'start',
          version: task.version,
        })
      ).json();
      const beforeJoin = task.version;
      task = (
        await send('PATCH', `/api/tasks/${task.id}`, {
          version: task.version,
          ownerId: first.id,
          collaboratorIds: [second.id, newcomer.id],
        })
      ).json();
      expect(task.status).toBe('in_progress');
      expect(task.collaborators.map((member: any) => member.id).sort()).toEqual(
        [second.id, newcomer.id].sort(),
      );
      expect(task.events.at(-1)).toMatchObject({
        type: 'participants_changed',
        payload: {
          before: { owner: { id: first.id }, collaborators: [{ id: second.id }] },
          after: { owner: { id: first.id } },
        },
      });
      expect(
        task.events
          .at(-1)
          .payload.after.collaborators.map((member: any) => member.id)
          .sort(),
      ).toEqual([second.id, newcomer.id].sort());
      expect(Date.parse(task.events.at(-1).created_at)).toBeGreaterThanOrEqual(
        Date.parse(task.events.at(-2).created_at),
      );
      expect(
        (
          await send('PATCH', `/api/tasks/${task.id}`, {
            version: beforeJoin,
            collaboratorIds: [],
          })
        ).statusCode,
      ).toBe(409);
      task = (
        await send('PATCH', `/api/tasks/${task.id}`, {
          version: task.version,
          ownerId: second.id,
          collaboratorIds: [first.id, newcomer.id],
        })
      ).json();
      expect(task.owner_id).toBe(second.id);
      expect(task.collaborators.map((member: any) => member.id).sort()).toEqual(
        [first.id, newcomer.id].sort(),
      );
      expect(task.events.at(-1).payload.before.owner.id).toBe(first.id);
      expect(task.events.at(-1).payload.after.owner.id).toBe(second.id);
      task = (
        await send('PATCH', `/api/tasks/${task.id}`, {
          version: task.version,
          collaboratorIds: [first.id],
        })
      ).json();
      expect(task.collaborators.map((member: any) => member.id)).toEqual([first.id]);
      expect(
        task.events.filter((event: any) => event.type === 'participants_changed'),
      ).toHaveLength(3);
      expect((await send('GET', `/api/tasks?memberId=${newcomer.id}`)).json()).toHaveLength(0);
      expect(
        (await send('GET', `/api/members/${newcomer.id}`))
          .json()
          .tasks.some((item: any) => item.id === task.id),
      ).toBe(true);
      await send('PATCH', `/api/members/${newcomer.id}`, { status: 'paused' });
      expect(
        (
          await send('PATCH', `/api/tasks/${task.id}`, {
            version: task.version,
            collaboratorIds: [first.id, newcomer.id],
          })
        ).statusCode,
      ).toBe(400);
      expect((await send('GET', `/api/tasks/${task.id}`)).json().version).toBe(task.version);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
