export const taskStatuses = ['todo', 'in_progress', 'pending_review', 'completed'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const memberStatuses = ['active', 'paused', 'left'] as const;
export type MemberStatus = (typeof memberStatuses)[number];
export function todayInZone(timeZone = 'Asia/Shanghai', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function workState(statuses: TaskStatus[]): 'idle' | 'working' | 'assigned' | 'review' {
  if (!statuses.length) return 'idle';
  if (statuses.includes('in_progress')) return 'working';
  if (statuses.includes('todo')) return 'assigned';
  return 'review';
}
export function weekStart(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((weekday + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}
export function addMonths(date: string, months: number) {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(date: string) {
  return addDays(addMonths(date, 1), -1);
}

export type RiskCode =
  'overdue' | 'pending_overdue' | 'due_today' | 'manual_delay' | 'due_soon' | 'pending_review';
export type RiskTask = {
  status: TaskStatus;
  deadline: string;
  risk_flag?: number | boolean | null;
  deleted_at?: string | null;
};

export function daysBetweenBusinessDates(start: string, end: string) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
}

export function taskAttentionSections(task: RiskTask, today: string) {
  if (task.status === 'completed' || task.deleted_at)
    return { today: false, upcoming: false, all: false };
  const daysUntilDue = daysBetweenBusinessDates(today, task.deadline);
  const todayAttention =
    daysUntilDue <= 0 || Boolean(task.risk_flag) || task.status === 'pending_review';
  const upcoming = daysUntilDue >= 1 && daysUntilDue <= 3;
  return { today: todayAttention, upcoming, all: todayAttention || upcoming };
}

export function taskRisk(task: RiskTask, today: string) {
  const codes: RiskCode[] = [];
  const attention = taskAttentionSections(task, today);
  if (attention.all) {
    const daysUntilDue = daysBetweenBusinessDates(today, task.deadline);
    if (daysUntilDue < 0)
      codes.push(task.status === 'pending_review' ? 'pending_overdue' : 'overdue');
    if (daysUntilDue === 0) codes.push('due_today');
    if (task.risk_flag) codes.push('manual_delay');
    if (attention.upcoming) codes.push('due_soon');
    if (task.status === 'pending_review') codes.push('pending_review');
  }
  const labels: Record<RiskCode, string> = {
    overdue: '已逾期',
    pending_overdue: '待确认超期',
    due_today: '今日截止',
    manual_delay: '可能延期',
    due_soon: '临近截止',
    pending_review: '待确认',
  };
  const rank: Record<RiskCode, number> = {
    overdue: 0,
    pending_overdue: 0,
    due_today: 1,
    manual_delay: 2,
    due_soon: 3,
    pending_review: 4,
  };
  return {
    codes,
    reasons: codes.map((code) => labels[code]),
    rank: codes.length ? Math.min(...codes.map((code) => rank[code])) : 5,
    overdueDays:
      codes.includes('overdue') || codes.includes('pending_overdue')
        ? -daysBetweenBusinessDates(today, task.deadline)
        : 0,
    isToday: attention.today,
    isUpcoming: attention.upcoming,
    isAttention: attention.all,
  };
}
