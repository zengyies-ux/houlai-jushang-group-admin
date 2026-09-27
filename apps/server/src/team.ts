import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { groupsTable, membersTable } from './schema';
import { date, parsed, Problem, requireRow, now } from './http';
import { todayInZone } from '../../../packages/shared/src/rules';

const groupInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const groupEdit = groupInput.partial().extend({
  status: z.enum(['active', 'disabled']).optional(),
  leaderId: z.string().uuid().nullable().optional(),
});
const memberBase = z.object({
  name: z.string().trim().min(1).max(100),
  nickname: z.string().trim().max(100).nullable().optional(),
  position: z.string().trim().max(100).optional(),
  groupId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'paused', 'left']).optional(),
  notes: z.string().max(2000).nullable().optional(),
  joinedAt: date,
});
const memberInput = memberBase.extend({
  position: z.string().trim().max(100).default(''),
  status: z.enum(['active', 'paused', 'left']).default('active'),
});
const memberEdit = memberBase.partial().extend({ leftAt: date.nullable().optional() });
type Group = { id: string; name: string; status: string; leader_id: string | null };
type Member = {
  id: string;
  name: string;
  group_id: string | null;
  status: string;
  joined_at: string;
  left_at: string | null;
};

export function registerTeam(app: FastifyInstance, db: Database.Database) {
  const orm = drizzle(db);
  const getGroup = (id: string) =>
    requireRow(db.prepare('SELECT * FROM groups WHERE id=?').get(id) as Group | undefined, '小组');
  const getMember = (id: string) =>
    requireRow(
      db.prepare('SELECT * FROM members WHERE id=?').get(id) as Member | undefined,
      '成员',
    );
  const fmtGroup = (g: any) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    leaderId: g.leader_id,
    status: g.status,
    notes: g.notes,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
  });
  const fmtMember = (m: any) => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    position: m.position,
    avatarId: m.avatar_id,
    groupId: m.group_id,
    status: m.status,
    notes: m.notes,
    joinedAt: m.joined_at,
    leftAt: m.left_at,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
  const selectableGroup = (id: string | null | undefined) => {
    if (!id) return;
    const g = getGroup(id);
    if (g.status !== 'active') throw new Problem(400, '停用小组不可用于新归组');
    return g;
  };
  const openHistory = (memberId: string, groupId: string | null, startedAt: string) =>
    db
      .prepare(
        'INSERT INTO member_group_history (id,member_id,group_id,group_name_snapshot,started_at) VALUES (?,?,?,?,?)',
      )
      .run(randomUUID(), memberId, groupId, groupId ? getGroup(groupId).name : null, startedAt);
  app.get('/api/groups', async () => orm.select().from(groupsTable).all());
  app.post('/api/groups', async (req, reply) => {
    const x = parsed(groupInput, req.body, reply);
    if (!x) return;
    const id = randomUUID(),
      t = now();
    db.prepare(
      'INSERT INTO groups (id,name,type,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(id, x.name, x.type ?? null, 'active', x.notes ?? null, t, t);
    return reply.code(201).send(fmtGroup(getGroup(id)));
  });
  app.patch<{ Params: { id: string } }>('/api/groups/:id', async (req, reply) => {
    const x = parsed(groupEdit, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const g = getGroup(id);
      if (x.leaderId !== undefined && x.leaderId !== null) {
        const m = getMember(x.leaderId);
        if (m.group_id !== id || m.status !== 'active')
          throw new Problem(400, '组长必须是本组在职成员');
      }
      db.prepare(
        'UPDATE groups SET name=?,type=?,notes=?,status=?,leader_id=?,updated_at=? WHERE id=?',
      ).run(
        x.name ?? g.name,
        x.type === undefined ? (g as any).type : x.type,
        x.notes === undefined ? (g as any).notes : x.notes,
        x.status ?? g.status,
        x.leaderId === undefined ? g.leader_id : x.leaderId,
        now(),
        id,
      );
    })();
    return fmtGroup(getGroup(id));
  });
  app.get('/api/members', async () => orm.select().from(membersTable).all());
  app.get<{ Params: { id: string } }>('/api/members/:id', async (req) => ({
    ...fmtMember(getMember(req.params.id)),
    history: db
      .prepare('SELECT * FROM member_group_history WHERE member_id=? ORDER BY started_at DESC')
      .all(req.params.id),
    tasks: (
      db
        .prepare(
          `SELECT DISTINCT t.* FROM tasks t LEFT JOIN task_collaborators c ON c.task_id=t.id LEFT JOIN task_events e ON e.task_id=t.id AND e.type IN ('created','participants_changed') WHERE t.deleted_at IS NULL AND (t.owner_id=? OR c.member_id=? OR e.payload_json LIKE ?) ORDER BY t.updated_at DESC`,
        )
        .all(req.params.id, req.params.id, `%${req.params.id}%`) as any[]
    ).map((t) => ({
      ...t,
      collaborators: db
        .prepare('SELECT member_id AS id FROM task_collaborators WHERE task_id=?')
        .all(t.id),
    })),
  }));
  app.post('/api/members', async (req, reply) => {
    const x = parsed(memberInput, req.body, reply);
    if (!x) return;
    const id = randomUUID(),
      t = now();
    db.transaction(() => {
      const timezone = (
        db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as { value: string }
      ).value;
      if (x.joinedAt > todayInZone(timezone)) throw new Problem(400, '加入日期不能晚于今天');
      selectableGroup(x.groupId);
      db.prepare(
        'INSERT INTO members (id,name,nickname,position,group_id,status,notes,joined_at,left_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        x.name,
        x.nickname ?? null,
        x.position,
        x.groupId ?? null,
        x.status,
        x.notes ?? null,
        x.joinedAt,
        x.status === 'left' ? x.joinedAt : null,
        t,
        t,
      );
      if (x.status !== 'left') openHistory(id, x.groupId ?? null, x.joinedAt);
    })();
    return reply.code(201).send(fmtMember(getMember(id)));
  });
  app.patch<{ Params: { id: string } }>('/api/members/:id', async (req, reply) => {
    const x = parsed(memberEdit, req.body, reply);
    if (!x) return;
    const id = req.params.id;
    db.transaction(() => {
      const m = getMember(id);
      const timezone = (
        db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as { value: string }
      ).value;
      const today = todayInZone(timezone);
      const status = x.status ?? m.status,
        groupId = x.groupId === undefined ? m.group_id : x.groupId;
      if (groupId !== m.group_id || (m.status === 'left' && status !== 'left'))
        selectableGroup(groupId);
      const changedGroup = groupId !== m.group_id,
        leaving = m.status !== 'left' && status === 'left',
        joining = m.status === 'left' && status !== 'left';
      if (changedGroup && status === 'left' && !leaving)
        throw new Problem(400, '已离组成员需要先恢复在职或暂停，才能重新归组');
      const changeDate = leaving ? (x.leftAt ?? today) : (x.joinedAt ?? today);
      if (changeDate > today || changeDate < m.joined_at)
        throw new Problem(400, '成员变更日期超出有效范围');
      const open = db
        .prepare(
          'SELECT started_at FROM member_group_history WHERE member_id=? AND ended_at IS NULL',
        )
        .get(id) as { started_at: string } | undefined;
      if (open && changeDate < open.started_at)
        throw new Problem(400, '成员变更日期不能早于当前组别关系开始日');
      if (changedGroup || leaving || joining)
        db.prepare(
          'UPDATE member_group_history SET ended_at=? WHERE member_id=? AND ended_at IS NULL',
        ).run(changeDate, id);
      if ((changedGroup || joining) && status !== 'left') openHistory(id, groupId, changeDate);
      if (status !== 'active' || changedGroup)
        db.prepare('UPDATE groups SET leader_id=NULL,updated_at=? WHERE leader_id=?').run(
          now(),
          id,
        );
      db.prepare(
        'UPDATE members SET name=?,nickname=?,position=?,group_id=?,status=?,notes=?,joined_at=?,left_at=?,updated_at=? WHERE id=?',
      ).run(
        x.name ?? m.name,
        x.nickname === undefined ? (m as any).nickname : x.nickname,
        x.position === undefined ? (m as any).position : x.position,
        groupId,
        status,
        x.notes === undefined ? (m as any).notes : x.notes,
        x.joinedAt ?? m.joined_at,
        status === 'left' ? (leaving ? changeDate : m.left_at) : null,
        now(),
        id,
      );
    })();
    return fmtMember(getMember(id));
  });
}
