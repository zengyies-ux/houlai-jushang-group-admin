import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  todayInZone,
  workState,
  weekStart,
  addDays,
  monthStart,
  monthEnd,
  taskRisk,
  type TaskStatus,
} from '../../../packages/shared/src/rules';
import { parsed, Problem } from './http';
import { dataEpoch } from './maintenance';

type Row = Record<string, any>;
export function registerViews(app: FastifyInstance, db: Database.Database) {
  const zone = () =>
    (db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as { value: string })
      .value;
  const allTasks = () =>
    db
      .prepare(
        `SELECT t.*,o.name owner_name,o.avatar_id owner_avatar_id,g.name group_name FROM tasks t JOIN members o ON o.id=t.owner_id LEFT JOIN groups g ON g.id=t.group_id WHERE t.deleted_at IS NULL ORDER BY t.deadline,t.created_at`,
      )
      .all() as Row[];
  const attach = (tasks: Row[]): Row[] => {
    const today = todayInZone(zone());
    return tasks.map((t) => {
      const risk = taskRisk(t as Row & { status: TaskStatus; deadline: string }, today);
      return {
        ...t,
        collaborators: db
          .prepare(
            'SELECT m.id,m.name FROM task_collaborators c JOIN members m ON m.id=c.member_id WHERE c.task_id=?',
          )
          .all(t.id) as Row[],
        risk_reasons: risk.codes,
        reasons: risk.reasons,
        risk_rank: risk.rank,
        overdue_days: risk.overdueDays,
        is_attention: risk.isAttention,
        attention_today: risk.isToday,
        attention_upcoming: risk.isUpcoming,
      };
    });
  };
  const calendarTasks = (start: string, end: string) =>
    attach(
      db
        .prepare(
          'SELECT t.*,m.name owner_name,m.avatar_id owner_avatar_id FROM tasks t JOIN members m ON m.id=t.owner_id WHERE t.deleted_at IS NULL AND t.deadline BETWEEN ? AND ? ORDER BY t.deadline,t.created_at',
        )
        .all(start, end) as Row[],
    );
  app.get('/api/overview', async () => {
    const today = todayInZone(zone());
    const groups = (db.prepare('SELECT * FROM groups ORDER BY status,name').all() as Row[]).map(
      (g) => ({ ...g, leaderId: g.leader_id }),
    );
    const members: Row[] = (
      db
        .prepare(
          'SELECT m.*,g.name group_name FROM members m LEFT JOIN groups g ON g.id=m.group_id ORDER BY m.status,m.name',
        )
        .all() as Row[]
    ).map((m) => ({
      ...m,
      groupId: m.group_id,
      avatarId: m.avatar_id,
      joinedAt: m.joined_at,
      leftAt: m.left_at,
      groupName: m.group_name,
    }));
    const tasks = attach(allTasks());
    const activeTasks = tasks.filter((t) => t.status !== 'completed');
    const byUrgency = (a: Row, b: Row) =>
      a.risk_rank - b.risk_rank || a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id);
    const todayRank = (task: Row) => {
      if (task.overdue_days > 0) return 0;
      if (task.risk_reasons.includes('due_today')) return 1;
      if (task.risk_reasons.includes('manual_delay')) return 2;
      return 3;
    };
    const byTodayAttention = (a: Row, b: Row) =>
      todayRank(a) - todayRank(b) ||
      a.deadline.localeCompare(b.deadline) ||
      a.id.localeCompare(b.id);
    const byMember: Row[] = members.map((m) => {
      const own = activeTasks
        .filter((t) => t.owner_id === m.id || t.collaborators.some((c: Row) => c.id === m.id))
        .sort(byUrgency);
      return {
        ...m,
        work_state:
          m.status === 'active' ? workState(own.map((t) => t.status as TaskStatus)) : null,
        current_tasks: own,
        pending_count: own.filter((t) => t.status === 'pending_review').length,
      };
    });
    const active = byMember.filter((m) => m.status === 'active');
    const overdue = activeTasks.filter((t) => t.overdue_days > 0),
      dueToday = activeTasks.filter((t) => t.risk_reasons.includes('due_today'));
    const attention = activeTasks.filter((t) => t.attention_today).sort(byTodayAttention);
    const upcoming = activeTasks
      .filter((t) => t.attention_upcoming)
      .sort(
        (a, b) =>
          a.deadline.localeCompare(b.deadline) ||
          (a.project_name?.trim() ?? '').localeCompare(b.project_name?.trim() ?? '', 'zh-CN') ||
          a.id.localeCompare(b.id),
      );
    const attentionCount = new Set([...attention, ...upcoming].map((t) => t.id)).size;
    const start = weekStart(today),
      end = addDays(start, 6);
    return {
      today,
      timezone: zone(),
      epoch: dataEpoch(),
      groups,
      members: byMember,
      counts: {
        active: active.length,
        working: active.filter((m) => m.work_state === 'working').length,
        assigned: active.filter((m) => m.work_state === 'assigned').length,
        review: active.filter((m) => m.work_state === 'review').length,
        idle: active.filter((m) => m.work_state === 'idle').length,
        pending: activeTasks.filter((t) => t.status === 'pending_review').length,
        unfinished: activeTasks.length,
        attention: attentionCount,
        overdue: overdue.length,
        dueToday: dueToday.length,
      },
      attention,
      upcoming,
      weekTasks: tasks.filter((t) => t.deadline >= start && t.deadline <= end),
      nearing: upcoming,
    };
  });
  app.get('/api/reviews', async () =>
    attach(
      db
        .prepare(
          "SELECT t.*,m.name owner_name,m.avatar_id owner_avatar_id FROM tasks t JOIN members m ON m.id=t.owner_id WHERE t.deleted_at IS NULL AND t.status='pending_review' ORDER BY t.submitted_at,t.created_at",
        )
        .all() as Row[],
    ),
  );
  app.get('/api/week', async (req, reply) => {
    const q = parsed(z.object({ date: z.iso.date().optional() }), req.query, reply);
    if (!q) return;
    const start = weekStart(q.date ?? todayInZone(zone())),
      end = addDays(start, 6);
    return {
      start,
      end,
      days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
      tasks: calendarTasks(start, end),
    };
  });
  app.get('/api/month', async (req, reply) => {
    const q = parsed(z.object({ date: z.iso.date().optional() }), req.query, reply);
    if (!q) return;
    const start = monthStart(q.date ?? todayInZone(zone())),
      end = monthEnd(start),
      gridStart = weekStart(start),
      gridEnd = addDays(weekStart(end), 6),
      days = Array.from(
        { length: Math.round((Date.parse(gridEnd) - Date.parse(gridStart)) / 86400000) + 1 },
        (_, i) => addDays(gridStart, i),
      );
    return { start, end, days, tasks: calendarTasks(gridStart, gridEnd) };
  });
  app.get('/api/settings', async () => ({ timezone: zone() }));
  app.put('/api/settings/timezone', async (req, reply) => {
    const x = parsed(z.object({ timezone: z.string().min(1).max(100) }), req.body, reply);
    if (!x) return;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: x.timezone });
    } catch {
      throw new Problem(400, '无效时区');
    }
    db.prepare("UPDATE settings SET value=? WHERE key='timezone'").run(x.timezone);
    return { timezone: x.timezone };
  });
}
