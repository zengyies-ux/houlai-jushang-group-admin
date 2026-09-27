import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parsed, Problem, requireRow, now } from './http';
import {
  taskInput,
  taskEdit,
  transitionInput,
  taskCommandInput,
  taskUpdateInput,
  taskRiskInput,
} from '../../../packages/shared/src/validation';
import { taskRisk, todayInZone, type TaskStatus } from '../../../packages/shared/src/rules';

type Task = {
  id: string;
  title: string;
  owner_id: string;
  group_id: string | null;
  deadline: string;
  start_date: string | null;
  status: string;
  version: number;
  created_at: string;
  deleted_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  progress: number | null;
  latest_update: string | null;
  latest_update_at: string | null;
  risk_flag: number;
  risk_note: string | null;
  [key: string]: unknown;
};
type Member = {
  id: string;
  name: string;
  group_id: string | null;
  status: string;
  avatar_id: string | null;
};
const idParam = z.object({ id: z.string().uuid() });

export function registerTasks(app: FastifyInstance, db: Database.Database) {
  const businessToday = () => {
    const setting = db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as
      { value: string } | undefined;
    return todayInZone(setting?.value);
  };
  const withRisk = <T extends Task>(t: T) => {
    const risk = taskRisk(t as T & { status: TaskStatus }, businessToday());
    return {
      ...t,
      risk_reasons: risk.codes,
      reasons: risk.reasons,
      risk_rank: risk.rank,
      overdue_days: risk.overdueDays,
      attention_today: risk.isToday,
      attention_upcoming: risk.isUpcoming,
      is_attention: risk.isAttention,
    };
  };
  const taskRow = (id: string, deleted = false) =>
    requireRow(
      db
        .prepare(`SELECT * FROM tasks WHERE id=? ${deleted ? '' : 'AND deleted_at IS NULL'}`)
        .get(id) as Task | undefined,
      '任务',
    );
  const member = (id: string) =>
    requireRow(
      db.prepare('SELECT id,name,group_id,status,avatar_id FROM members WHERE id=?').get(id) as
        Member | undefined,
      '成员',
    );
  const activeMember = (id: string) => {
    const m = member(id);
    if (m.status !== 'active') throw new Problem(400, '只能指派在职成员');
    return m;
  };
  const group = (id: string | null | undefined) => {
    if (!id) return null;
    const g = requireRow(
      db.prepare('SELECT id,name,status FROM groups WHERE id=?').get(id) as
        { id: string; name: string; status: string } | undefined,
      '小组',
    );
    if (g.status !== 'active') throw new Problem(400, '停用小组不可用于新任务');
    return g;
  };
  const collabs = (id: string) =>
    (
      db
        .prepare('SELECT member_id FROM task_collaborators WHERE task_id=? ORDER BY member_id')
        .all(id) as { member_id: string }[]
    ).map((x) => x.member_id);
  const snapshot = (ownerId: string, ids: string[], groupId: string | null) => ({
    owner: member(ownerId),
    collaborators: ids.map(member),
    group: groupId ? db.prepare('SELECT id,name FROM groups WHERE id=?').get(groupId) : null,
  });
  const event = (
    id: string,
    type: string,
    from: string | null,
    to: string | null,
    payload: unknown = {},
    comment: string | null = null,
  ) =>
    db
      .prepare(
        'INSERT INTO task_events (id,task_id,type,from_status,to_status,comment,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(randomUUID(), id, type, from, to, comment, JSON.stringify(payload), now());
  const getTask = (id: string) => {
    const t = taskRow(id);
    const owner = member(t.owner_id);
    return withRisk({
      ...t,
      collaborators: db
        .prepare(
          'SELECT m.id,m.name,m.status,m.group_id FROM task_collaborators c JOIN members m ON m.id=c.member_id WHERE c.task_id=?',
        )
        .all(id),
      owner: { ...owner, avatarId: owner.avatar_id },
      owner_avatar_id: owner.avatar_id,
      group: t.group_id
        ? db.prepare('SELECT id,name,status FROM groups WHERE id=?').get(t.group_id)
        : null,
      events: (
        db.prepare('SELECT * FROM task_events WHERE task_id=? ORDER BY rowid').all(id) as any[]
      ).map((e) => ({ ...e, payload: JSON.parse(e.payload_json) })),
    });
  };
  const checkVersion = (t: Task, version: number) => {
    if (t.version !== version) throw new Problem(409, '该任务已更新，请刷新后重试');
  };
  const update = (id: string, version: number, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    const fields = keys.length ? `${keys.map((k) => `${k}=?`).join(',')},` : '';
    const sql = `UPDATE tasks SET ${fields}version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL`;
    const result = db.prepare(sql).run(...keys.map((k) => values[k]), now(), id, version);
    if (!result.changes) throw new Problem(409, '该任务已更新，请刷新后重试');
  };

  app.get('/api/tasks', async (req, reply) => {
    const q = parsed(
      z.object({
        groupId: z.string().uuid().optional(),
        memberId: z.string().uuid().optional(),
        status: z
          .enum(['todo', 'in_progress', 'pending_review', 'completed', 'unfinished'])
          .optional(),
        deadline: z.iso.date().optional(),
        search: z.string().max(100).optional(),
        projectName: z.string().max(100).optional(),
        riskOnly: z.enum(['true', 'false']).optional(),
        attention: z.enum(['today', 'upcoming', 'all']).optional(),
      }),
      req.query,
      reply,
    );
    if (!q) return;
    const conditions = ['t.deleted_at IS NULL'];
    const args: unknown[] = [];
    if (q.groupId) {
      conditions.push('t.group_id=?');
      args.push(q.groupId);
    }
    if (q.memberId) {
      conditions.push(
        '(t.owner_id=? OR EXISTS(SELECT 1 FROM task_collaborators c WHERE c.task_id=t.id AND c.member_id=?))',
      );
      args.push(q.memberId, q.memberId);
    }
    if (q.status === 'unfinished') {
      conditions.push("t.status<>'completed'");
    } else if (q.status) {
      conditions.push('t.status=?');
      args.push(q.status);
    }
    if (q.projectName !== undefined) {
      if (q.projectName.trim()) {
        conditions.push('TRIM(t.project_name)=?');
        args.push(q.projectName.trim());
      } else conditions.push("(t.project_name IS NULL OR TRIM(t.project_name)='')");
    }
    if (q.deadline) {
      conditions.push('t.deadline=?');
      args.push(q.deadline);
    }
    if (q.search) {
      conditions.push('(t.title LIKE ? OR t.project_name LIKE ?)');
      args.push(`%${q.search}%`, `%${q.search}%`);
    }
    const attention = q.attention ?? (q.riskOnly === 'true' ? 'all' : undefined);
    return db
      .prepare(
        `SELECT t.*,m.name AS owner_name,m.avatar_id AS owner_avatar_id,g.name AS group_name FROM tasks t JOIN members m ON m.id=t.owner_id LEFT JOIN groups g ON g.id=t.group_id WHERE ${conditions.join(' AND ')} ORDER BY CASE t.status WHEN 'pending_review' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,t.deadline,t.created_at DESC`,
      )
      .all(...args)
      .map((t: any) =>
        withRisk({
          ...t,
          collaborators: db
            .prepare(
              'SELECT m.id,m.name FROM task_collaborators c JOIN members m ON m.id=c.member_id WHERE c.task_id=?',
            )
            .all(t.id),
        }),
      )
      .filter(
        (t) =>
          (!attention ||
            (attention === 'today'
              ? t.attention_today
              : attention === 'upcoming'
                ? t.attention_upcoming
                : t.is_attention)),
      )
      .sort((a: any, b: any) =>
        attention === 'upcoming'
          ? a.deadline.localeCompare(b.deadline) ||
            (a.project_name?.trim() || '').localeCompare(b.project_name?.trim() || '', 'zh-CN') ||
            a.id.localeCompare(b.id)
          : attention
            ? a.risk_rank - b.risk_rank ||
              a.deadline.localeCompare(b.deadline) ||
              a.id.localeCompare(b.id)
            : 0,
      );
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => getTask(req.params.id));
  app.post('/api/tasks', async (req, reply) => {
    const x = parsed(taskInput, req.body, reply);
    if (!x) return;
    const id = randomUUID(),
      t = now();
    db.transaction(() => {
      activeMember(x.ownerId);
      group(x.groupId);
      const ids = [...new Set(x.collaboratorIds)];
      if (ids.length !== x.collaboratorIds.length || ids.includes(x.ownerId))
        throw new Problem(400, '协作者不能重复或包含负责人');
      ids.forEach(activeMember);
      db.prepare(
        'INSERT INTO tasks (id,title,project_name,description,notes,group_id,owner_id,status,progress,priority,start_date,deadline,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
      ).run(
        id,
        x.title,
        x.projectName ?? null,
        x.description ?? null,
        x.notes ?? null,
        x.groupId ?? null,
        x.ownerId,
        'todo',
        x.progress ?? null,
        x.priority ?? null,
        x.startDate ?? null,
        x.deadline,
        t,
        t,
      );
      const insert = db.prepare('INSERT INTO task_collaborators VALUES (?,?)');
      ids.forEach((mid) => insert.run(id, mid));
      event(id, 'created', null, 'todo', {
        title: x.title,
        deadline: x.deadline,
        participants: snapshot(x.ownerId, ids, x.groupId ?? null),
      });
    })();
    return reply.code(201).send(getTask(id));
  });
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const x = parsed(taskEdit, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      const ownerId = x.ownerId ?? old.owner_id;
      const groupId = x.groupId === undefined ? old.group_id : x.groupId;
      const ids = x.collaboratorIds ?? collabs(id);
      if (x.ownerId !== undefined && x.ownerId !== old.owner_id) activeMember(ownerId);
      if (x.groupId !== undefined && groupId !== old.group_id) group(groupId);
      if (x.collaboratorIds !== undefined) {
        if (new Set(ids).size !== ids.length || ids.includes(ownerId))
          throw new Problem(400, '协作者不能重复或包含负责人');
        ids.filter((mid) => !collabs(id).includes(mid)).forEach(activeMember);
      } else if (ids.includes(ownerId)) throw new Problem(400, '新负责人不能同时是协作者');
      const deadline = x.deadline ?? old.deadline,
        startDate = x.startDate === undefined ? old.start_date : x.startDate;
      if (startDate && startDate > deadline) throw new Problem(400, '开始日不能晚于截止日');
      const changedParticipants =
        ownerId !== old.owner_id ||
        groupId !== old.group_id ||
        JSON.stringify([...ids].sort()) !== JSON.stringify([...collabs(id)].sort());
      const before = changedParticipants ? snapshot(old.owner_id, collabs(id), old.group_id) : null;
      const values: Record<string, unknown> = {};
      const map = {
        title: 'title',
        projectName: 'project_name',
        description: 'description',
        notes: 'notes',
        groupId: 'group_id',
        ownerId: 'owner_id',
        progress: 'progress',
        priority: 'priority',
        startDate: 'start_date',
        deadline: 'deadline',
      } as const;
      for (const [key, column] of Object.entries(map))
        if ((x as any)[key] !== undefined && (x as any)[key] !== old[column])
          values[column] = (x as any)[key];
      if (!Object.keys(values).length && !changedParticipants)
        throw new Problem(400, '没有修改内容');
      update(id, x.version, values);
      if (x.collaboratorIds !== undefined) {
        db.prepare('DELETE FROM task_collaborators WHERE task_id=?').run(id);
        const insert = db.prepare('INSERT INTO task_collaborators VALUES (?,?)');
        ids.forEach((mid) => insert.run(id, mid));
      }
      if (changedParticipants)
        event(id, 'participants_changed', old.status, old.status, {
          before,
          after: snapshot(ownerId, ids, groupId),
        });
      if (deadline !== old.deadline)
        event(id, 'deadline_changed', old.status, old.status, {
          before: old.deadline,
          after: deadline,
        });
      const otherFields = Object.fromEntries(
        Object.entries(values).filter(
          ([key]) => !['group_id', 'owner_id', 'deadline'].includes(key),
        ),
      );
      if (Object.keys(otherFields).length)
        event(id, 'fields_changed', old.status, old.status, { fields: otherFields });
    })();
    return getTask(id);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/transition', async (req, reply) => {
    const x = parsed(transitionInput, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      const rules: Record<string, [string, string, string]> = {
        start: ['todo', 'in_progress', 'started'],
        submit: ['in_progress', 'pending_review', 'submitted'],
        approve: ['pending_review', 'completed', 'approved'],
        reject: ['pending_review', 'in_progress', 'rejected'],
        undo_approve: ['completed', 'pending_review', 'approval_undone'],
      };
      const [from, to, type] = rules[x.action];
      if (old.status !== from) throw new Problem(409, '当前状态不允许此操作，请刷新任务');
      if (x.action === 'undo_approve') {
        const last = db
          .prepare('SELECT type FROM task_events WHERE task_id=? ORDER BY rowid DESC LIMIT 1')
          .get(id) as { type: string } | undefined;
        if (last?.type !== 'approved')
          throw new Problem(409, '这不是可撤销的旧验收，请使用任务详情中的重新打开');
      }
      const values: Record<string, unknown> = { status: to };
      let payload: Record<string, unknown> = {};
      if (x.action === 'submit') {
        const actual = x.submittedAt ?? now();
        const last = db
          .prepare(
            "SELECT created_at FROM task_events WHERE task_id=? AND type IN ('started','rejected') ORDER BY created_at DESC LIMIT 1",
          )
          .get(id) as { created_at: string } | undefined;
        if (
          new Date(actual).getTime() > Date.now() + 1000 ||
          new Date(actual).getTime() < new Date(last?.created_at ?? old.created_at).getTime()
        )
          throw new Problem(400, '实际提交时间超出本轮制作时间范围');
        values.submitted_at = actual;
        payload = { actualSubmittedAt: actual };
      }
      if (x.action === 'approve') {
        values.completed_at = now();
        values.progress = 100;
        values.risk_flag = 0;
        values.risk_note = null;
      }
      if (x.action === 'reject') {
        values.progress = null;
      }
      if (x.action === 'undo_approve') {
        values.completed_at = null;
        values.progress = null;
      }
      update(id, x.version, values);
      event(id, type, from, to, payload, x.comment ?? null);
    })();
    return getTask(id);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/command', async (req, reply) => {
    const x = parsed(taskCommandInput, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      const rules: Record<string, { from: string[]; to: string; type: string }> = {
        start: { from: ['todo'], to: 'in_progress', type: 'started' },
        complete: {
          from: ['todo', 'in_progress', 'pending_review'],
          to: 'completed',
          type: 'completed',
        },
        mark_pending: {
          from: ['todo', 'in_progress'],
          to: 'pending_review',
          type: 'pending_marked',
        },
        resume: { from: ['pending_review'], to: 'in_progress', type: 'resumed' },
        reopen: { from: ['completed'], to: 'in_progress', type: 'reopened' },
        reset_to_todo: {
          from: ['in_progress', 'pending_review'],
          to: 'todo',
          type: 'reset_to_todo',
        },
      };
      if (x.action === 'undo_complete') {
        if (old.status !== 'completed')
          throw new Problem(409, '当前状态无法撤销完成，请重新打开任务');
        const last = db
          .prepare(
            'SELECT type,payload_json FROM task_events WHERE task_id=? ORDER BY rowid DESC LIMIT 1',
          )
          .get(id) as { type: string; payload_json: string } | undefined;
        if (last?.type !== 'completed')
          throw new Problem(409, '完成后已有其他修改，请从任务详情重新打开');
        const payload = JSON.parse(last.payload_json) as {
          completedVersion?: number;
          before?: {
            status: string;
            progress: number | null;
            completedAt: string | null;
            riskFlag: number;
            riskNote: string | null;
          };
        };
        if (!payload.before || payload.completedVersion !== old.version)
          throw new Problem(409, '完成后已有其他修改，请从任务详情重新打开');
        const before = payload.before;
        update(id, x.version, {
          status: before.status,
          progress: before.progress,
          completed_at: before.completedAt,
          risk_flag: before.riskFlag,
          risk_note: before.riskNote,
        });
        event(
          id,
          'completion_undone',
          old.status,
          before.status,
          { restored: before },
          x.comment ?? null,
        );
        return;
      }
      const rule = rules[x.action];
      if (!rule.from.includes(old.status))
        throw new Problem(409, '当前状态不允许此操作，请刷新任务');
      const values: Record<string, unknown> = { status: rule.to };
      const payload: Record<string, unknown> = {};
      if (x.action === 'complete') {
        payload.before = {
          status: old.status,
          progress: old.progress,
          completedAt: old.completed_at,
          riskFlag: old.risk_flag,
          riskNote: old.risk_note,
        };
        payload.completedVersion = old.version + 1;
        values.completed_at = now();
        values.progress = 100;
        values.risk_flag = 0;
        values.risk_note = null;
      }
      if (x.action === 'reopen') {
        values.completed_at = null;
        values.progress = null;
        values.risk_flag = 0;
        values.risk_note = null;
      }
      if (x.action === 'reset_to_todo') values.progress = null;
      update(id, x.version, values);
      event(id, rule.type, old.status, rule.to, payload, x.comment ?? null);
    })();
    return getTask(id);
  });
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/update', async (req, reply) => {
    const x = parsed(taskUpdateInput, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      const value = x.latestUpdate || null;
      if (value === old.latest_update) throw new Problem(400, '进展内容没有修改');
      update(id, x.version, {
        latest_update: value,
        latest_update_at: value ? now() : null,
      });
      event(id, 'update_recorded', old.status, old.status, {
        before: old.latest_update,
        after: value,
      });
    })();
    return getTask(id);
  });
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/risk', async (req, reply) => {
    const x = parsed(taskRiskInput, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      if (old.status === 'completed') throw new Problem(400, '已完成任务无需标记延期');
      const flag = x.riskFlag ? 1 : 0;
      const note = flag ? (x.riskNote === undefined ? old.risk_note : x.riskNote || null) : null;
      if (old.risk_flag === flag && old.risk_note === note)
        throw new Problem(400, '风险标记没有修改');
      update(id, x.version, { risk_flag: flag, risk_note: note });
      event(id, flag ? 'risk_marked' : 'risk_cleared', old.status, old.status, {
        before: { flag: old.risk_flag, note: old.risk_note },
        after: { flag, note },
      });
    })();
    return getTask(id);
  });
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const x = parsed(z.object({ version: z.number().int().positive() }), req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const old = taskRow(id);
      checkVersion(old, x.version);
      update(id, x.version, { deleted_at: now() });
      event(id, 'deleted', old.status, old.status);
    })();
    return { ok: true };
  });
}
