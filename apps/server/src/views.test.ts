import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';
import { addDays, addMonths } from '../../../packages/shared/src/rules';
describe('总览去重与逾期', () => {
  it('按成员参与关系分类，并区分任务数量和人员数量', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-views-')),
      db = openDatabase(join(process.cwd(), 'drizzle'), dir),
      app = createApp(db);
    const post = async (url: string, payload: any) =>
      (await app.inject({ method: 'POST', url, payload })).json();
    try {
      const today = (await app.inject('/api/overview')).json().today,
        yesterday = addDays(today, -1);
      const a = await post('/api/members', { name: '甲', joinedAt: '2026-01-01' }),
        b = await post('/api/members', { name: '乙', joinedAt: '2026-01-01' }),
        c = await post('/api/members', { name: '丙', joinedAt: '2026-01-01' });
      await post('/api/tasks', {
        title: '未开始逾期',
        ownerId: a.id,
        deadline: yesterday,
        collaboratorIds: [b.id],
      });
      let review = await post('/api/tasks', {
        title: '待验收逾期',
        ownerId: c.id,
        deadline: yesterday,
        collaboratorIds: [a.id],
      });
      review = await post(`/api/tasks/${review.id}/transition`, {
        action: 'start',
        version: review.version,
      });
      await post(`/api/tasks/${review.id}/transition`, {
        action: 'submit',
        version: review.version,
      });
      const overview = (await app.inject('/api/overview')).json();
      expect(overview.counts).toMatchObject({
        active: 3,
        assigned: 2,
        review: 1,
        working: 0,
        idle: 0,
        pending: 1,
        overdue: 2,
        dueToday: 0,
      });
      expect(overview.attention).toHaveLength(2);
      expect(overview.attention.find((t: any) => t.title === '待验收逾期').reasons).toContain(
        '待确认超期',
      );
      expect(overview.members.find((m: any) => m.id === b.id).current_tasks).toHaveLength(1);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('周与月读取同一任务，改期后两视图同步', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-calendar-')),
      db = openDatabase(join(process.cwd(), 'drizzle'), dir),
      app = createApp(db);
    try {
      const today = (await app.inject('/api/overview')).json().today;
      const member = (
        await app.inject({
          method: 'POST',
          url: '/api/members',
          payload: { name: '日历成员', joinedAt: today },
        })
      ).json();
      const created = (
        await app.inject({
          method: 'POST',
          url: '/api/tasks',
          payload: { title: '日历同步', ownerId: member.id, deadline: today },
        })
      ).json();
      const week = (await app.inject(`/api/week?date=${today}`)).json();
      const month = (await app.inject(`/api/month?date=${today}`)).json();
      expect(week.tasks.some((t: any) => t.id === created.id)).toBe(true);
      expect(month.tasks.some((t: any) => t.id === created.id)).toBe(true);
      const nextMonth = addDays(addMonths(today, 1), 7);
      const changed = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${created.id}`,
        payload: { version: created.version, deadline: nextMonth },
      });
      expect(changed.statusCode).toBe(200);
      expect(
        (await app.inject(`/api/week?date=${today}`))
          .json()
          .tasks.some((t: any) => t.id === created.id),
      ).toBe(false);
      expect(
        (await app.inject(`/api/month?date=${nextMonth}`))
          .json()
          .tasks.some((t: any) => t.id === created.id),
      ).toBe(true);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('今天区按逾期、今日、人工、待确认排序，未来区独立计数', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-attention-')),
      db = openDatabase(join(process.cwd(), 'drizzle'), dir),
      app = createApp(db);
    try {
      const today = (await app.inject('/api/overview')).json().today;
      const member = (
        await app.inject({
          method: 'POST',
          url: '/api/members',
          payload: { name: '关注成员', joinedAt: today },
        })
      ).json();
      const create = async (title: string, deadline: string, projectName?: string) =>
        (
          await app.inject({
            method: 'POST',
            url: '/api/tasks',
            payload: { title, deadline, ownerId: member.id, projectName },
          })
        ).json();
      await create('逾期', addDays(today, -1));
      await create('今日', today);
      let manual = await create('人工', addDays(today, 7), '项目 A');
      manual = (
        await app.inject({
          method: 'PATCH',
          url: `/api/tasks/${manual.id}/risk`,
          payload: { version: manual.version, riskFlag: true },
        })
      ).json();
      await create('临近', addDays(today, 1));
      let pending = await create('待确认', addDays(today, 9));
      pending = (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${pending.id}/command`,
          payload: { version: pending.version, action: 'mark_pending' },
        })
      ).json();
      let completed = await create('已完成逾期', addDays(today, -2));
      completed = (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${completed.id}/command`,
          payload: { version: completed.version, action: 'complete' },
        })
      ).json();
      const overview = (await app.inject('/api/overview')).json();
      expect(overview.attention.map((t: any) => t.title)).toEqual([
        '逾期',
        '今日',
        '人工',
        '待确认',
      ]);
      expect(overview.upcoming.map((t: any) => t.title)).toEqual(['临近']);
      expect(overview.counts).toMatchObject({ unfinished: 5, attention: 5 });
      expect((await app.inject('/api/tasks?riskOnly=true')).json()).toHaveLength(5);
      expect((await app.inject('/api/tasks?status=unfinished')).json()).toHaveLength(5);
      expect(
        (await app.inject(`/api/tasks?projectName=${encodeURIComponent('项目 A')}`)).json(),
      ).toMatchObject([{ title: '人工' }]);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('三天窗口、双区重叠、精确筛选与任务变更保持一致', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T16:30:00Z'));
    const dir = mkdtempSync(join(tmpdir(), 'workbench-three-days-')),
      db = openDatabase(join(process.cwd(), 'drizzle'), dir),
      app = createApp(db);
    const send = async (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: string,
      payload?: any,
    ) => {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(400);
      return res.json();
    };
    try {
      const today = (await send('GET', '/api/overview')).today;
      expect(today).toBe('2026-09-27');
      const group = await send('POST', '/api/groups', { name: '交付组' });
      const owner = await send('POST', '/api/members', {
        name: '负责人',
        groupId: group.id,
        joinedAt: today,
      });
      const collaborator = await send('POST', '/api/members', {
        name: '协作者',
        groupId: group.id,
        joinedAt: today,
      });
      const make = (title: string, offset: number, projectName?: string, collaborate = false) =>
        send('POST', '/api/tasks', {
          title,
          deadline: addDays(today, offset),
          ownerId: owner.id,
          groupId: group.id,
          projectName,
          collaboratorIds: collaborate ? [collaborator.id] : [],
        });
      const overdue = await make('已逾期', -1);
      const dueToday = await make('今天截止', 0);
      let tomorrow = await make('明天人工延期', 1, '  项目甲  ', true);
      let afterTwoB = await make('后天待确认', 2, '项目乙');
      let afterTwoA = await make('后天普通', 2, '项目甲');
      let afterThree = await make('大后天', 3);
      const afterFour = await make('四天后', 4);
      tomorrow = await send('PATCH', `/api/tasks/${tomorrow.id}/risk`, {
        version: tomorrow.version,
        riskFlag: true,
      });
      afterTwoB = await send('POST', `/api/tasks/${afterTwoB.id}/command`, {
        version: afterTwoB.version,
        action: 'mark_pending',
      });
      let overview = await send('GET', '/api/overview');
      expect(overview.attention.map((t: any) => t.id)).toEqual([
        overdue.id,
        dueToday.id,
        tomorrow.id,
        afterTwoB.id,
      ]);
      expect(overview.upcoming.map((t: any) => t.id)).toEqual([
        tomorrow.id,
        afterTwoA.id,
        afterTwoB.id,
        afterThree.id,
      ]);
      expect(overview.upcoming[0].project_name).toBe('项目甲');
      expect(overview.counts).toMatchObject({ unfinished: 7, attention: 6 });
      const ids = (items: any[]) => items.map((item) => item.id).sort();
      expect(ids(await send('GET', '/api/tasks?attention=today'))).toEqual(ids(overview.attention));
      expect(ids(await send('GET', '/api/tasks?attention=upcoming'))).toEqual(
        ids(overview.upcoming),
      );
      expect((await send('GET', '/api/tasks?attention=all')).length).toBe(6);
      expect(
        ids(await send('GET', `/api/tasks?attention=upcoming&memberId=${collaborator.id}`)),
      ).toEqual([tomorrow.id]);
      expect((await send('GET', `/api/tasks?attention=upcoming&groupId=${group.id}`)).length).toBe(
        4,
      );
      await send('PATCH', `/api/groups/${group.id}`, { status: 'disabled' });
      await send('PATCH', `/api/members/${collaborator.id}`, { status: 'left' });
      overview = await send('GET', '/api/overview');
      expect(overview.upcoming.map((t: any) => t.id)).toContain(tomorrow.id);
      afterThree = await send('PATCH', `/api/tasks/${afterThree.id}`, {
        version: afterThree.version,
        deadline: addDays(today, 4),
      });
      expect((await send('GET', '/api/overview')).upcoming).toHaveLength(3);
      afterTwoA = await send('POST', `/api/tasks/${afterTwoA.id}/command`, {
        version: afterTwoA.version,
        action: 'complete',
      });
      expect((await send('GET', '/api/overview')).upcoming).toHaveLength(2);
      afterTwoA = await send('POST', `/api/tasks/${afterTwoA.id}/command`, {
        version: afterTwoA.version,
        action: 'undo_complete',
      });
      expect((await send('GET', '/api/overview')).upcoming).toHaveLength(3);
      await send('DELETE', `/api/tasks/${afterTwoB.id}`, { version: afterTwoB.version });
      overview = await send('GET', '/api/overview');
      expect(overview.attention.map((t: any) => t.id)).not.toContain(afterTwoB.id);
      expect(overview.upcoming).toHaveLength(2);
      expect(overview.counts.attention).toBe(4);
      vi.setSystemTime(new Date('2026-09-27T16:30:00Z'));
      overview = await send('GET', '/api/overview');
      expect(overview.today).toBe('2026-09-28');
      expect(overview.upcoming.map((t: any) => t.id)).toContain(afterFour.id);
      expect(overview.upcoming.map((t: any) => t.id)).not.toContain(tomorrow.id);
      expect(overview.attention.map((t: any) => t.id)).toContain(tomorrow.id);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });
});
