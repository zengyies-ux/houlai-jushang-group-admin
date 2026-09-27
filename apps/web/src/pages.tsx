import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, FolderPlus, UserPlus } from 'lucide-react';
import {
  api,
  send,
  memberStatusNames,
  dateLabel,
  type Overview,
  type Task,
  type Member,
} from './api';
import { Button, Card, Pill, Empty, ErrorBox, Loading } from './ui';
import type { OpenTaskDefaults } from './App';
import { MemberFormDrawer, GroupFormDrawer, GroupManageDrawer } from './drawers';
import { addDays, addMonths, monthStart, weekStart } from '../../../packages/shared/src/rules';
import { FarmMemberRow } from './farm-pages';
import { TaskDateControl, TaskStatusControl } from './task-actions';

type Actions = {
  openTask: (id: string) => void;
  openMember: (id: string) => void;
  newTask: (defaults?: OpenTaskDefaults) => void;
};
const head = (eyebrow: string, title: string, description: string, actions?: React.ReactNode) => (
  <div className="page-head">
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {actions}
  </div>
);

export function TeamPage({ data, actions }: { data: Overview; actions: Actions }) {
  const qc = useQueryClient();
  const [memberForm, setMemberForm] = useState<{ groupId?: string } | null>(null),
    [groupForm, setGroupForm] = useState(false),
    [manage, setManage] = useState<string | null>(null),
    [showInactive, setShowInactive] = useState(false),
    [groupFilter, setGroupFilter] = useState(''),
    [positionFilter, setPositionFilter] = useState(''),
    [statusFilter, setStatusFilter] = useState(''),
    [assigning, setAssigning] = useState<string | null>(null),
    [assignError, setAssignError] = useState('');
  const assignGroup = async (memberId: string, groupId: string) => {
    if (!groupId) return;
    setAssigning(memberId);
    setAssignError('');
    try {
      await send(`/members/${memberId}`, 'PATCH', { groupId });
      await qc.invalidateQueries();
    } catch (e) {
      setAssignError((e as Error).message);
    } finally {
      setAssigning(null);
    }
  };
  const visibleMember = (m: Member) =>
    (!groupFilter || (groupFilter === 'ungrouped' ? !m.groupId : m.groupId === groupFilter)) &&
    (!positionFilter || m.position === positionFilter) &&
    (!statusFilter || m.status === statusFilter) &&
    (showInactive || statusFilter === 'left' || m.status !== 'left');
  return (
    <>
      {head(
        '团队工作台',
        '团队',
        '小组与成员关系，连同变更历史一起保存。',
        <div className="head-actions">
          <Button variant="secondary" onClick={() => setGroupForm(true)}>
            <FolderPlus size={16} /> 新建小组
          </Button>
          <Button onClick={() => setMemberForm({})}>
            <UserPlus size={16} /> 新增成员
          </Button>
        </div>,
      )}
      <div className="toolbar">
        <span>
          {data.members.filter((m) => m.status === 'active').length} 位在职成员 ·{' '}
          {data.groups.filter((g) => g.status === 'active').length} 个启用小组
        </span>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />{' '}
          显示停用小组与离组成员
        </label>
      </div>
      <Card className="filterbar">
        <select
          aria-label="筛选成员小组"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        >
          <option value="">全部小组</option>
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="ungrouped">未分组</option>
        </select>
        <select
          aria-label="筛选成员职位"
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
        >
          <option value="">全部职位</option>
          {[...new Set(data.members.map((m) => m.position).filter(Boolean))].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选成员在职状态"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">全部在职状态</option>
          {Object.entries(memberStatusNames).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Card>
      {data.groups
        .filter(
          (g) =>
            (!groupFilter || groupFilter === g.id) &&
            (showInactive || statusFilter === 'left' || g.status === 'active'),
        )
        .map((g) => (
          <Card key={g.id} className="team-section">
            <div className="team-section-head">
              <div>
                <h2>
                  {g.name} {g.status === 'disabled' && <Pill>已停用</Pill>}
                </h2>
                <p>
                  {g.type || '制作小组'} · 组长{' '}
                  {data.members.find((m) => m.id === g.leaderId)?.name || '待指定'}
                </p>
              </div>
              <div className="head-actions">
                <Button variant="ghost" onClick={() => setManage(g.id)}>
                  管理小组
                </Button>
                {g.status === 'active' && (
                  <Button variant="ghost" onClick={() => setMemberForm({ groupId: g.id })}>
                    <UserPlus size={15} /> 添加成员
                  </Button>
                )}
                {g.status === 'active' && (
                  <Button variant="ghost" onClick={() => actions.newTask({ groupId: g.id })}>
                    <Plus size={15} /> 分配任务
                  </Button>
                )}
              </div>
            </div>
            <div className="team-member-list farm-team-members">
              {data.members
                .filter((m) => m.groupId === g.id && visibleMember(m))
                .map((m) => (
                  <FarmMemberRow
                    key={m.id}
                    member={m}
                    data={data}
                    actions={actions}
                    leader={g.leaderId === m.id}
                  />
                ))}
              {!data.members.some((m) => m.groupId === g.id && visibleMember(m)) && (
                <Empty title="这个小组还没有成员" />
              )}
            </div>
          </Card>
        ))}
      {(!groupFilter || groupFilter === 'ungrouped') && (
        <Card className="team-section">
          <div className="team-section-head">
            <h2>未分组成员</h2>
            <p>在成员右侧直接选择小组，任务和历史记录会保留。</p>
          </div>
          {assignError && <p className="form-error padding">{assignError}</p>}
          <div className="team-member-list">
            {data.members
              .filter((m) => !m.groupId && visibleMember(m))
              .map((m) => (
                <div className="team-member-row" key={m.id}>
                  <FarmMemberRow member={m} data={data} actions={actions} />
                  <select
                    className="assign-select"
                    aria-label={`给${m.name}分配小组`}
                    value=""
                    disabled={assigning === m.id || !data.groups.some((g) => g.status === 'active')}
                    onChange={(e) => void assignGroup(m.id, e.target.value)}
                  >
                    <option value="">分配小组…</option>
                    {data.groups
                      .filter((g) => g.status === 'active')
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            {!data.members.some((m) => !m.groupId && visibleMember(m)) && (
              <p className="muted padding">暂无未分组成员</p>
            )}
          </div>
        </Card>
      )}
      <MemberFormDrawer
        open={memberForm !== null}
        initialGroupId={memberForm?.groupId}
        onClose={() => setMemberForm(null)}
        today={data.today}
      />
      <GroupFormDrawer open={groupForm} onClose={() => setGroupForm(false)} />
      <GroupManageDrawer id={manage} onClose={() => setManage(null)} />
    </>
  );
}

export function WeekPage({ data, actions }: { data: Overview; actions: Actions }) {
  const [date, setDate] = useState(data.today);
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const week = useQuery({
    queryKey: ['week', date],
    queryFn: () =>
      api<{ start: string; end: string; days: string[]; tasks: Task[] }>(`/week?date=${date}`),
    enabled: mode === 'week',
  });
  const month = useQuery({
    queryKey: ['month', monthStart(date)],
    queryFn: () =>
      api<{ start: string; end: string; days: string[]; tasks: Task[] }>(`/month?date=${date}`),
    enabled: mode === 'month',
  });
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const current = mode === 'week' ? week : month;
  const move = (offset: number) =>
    setDate(mode === 'week' ? addDays(weekStart(date), offset * 7) : addMonths(date, offset));
  return (
    <>
      {head(
        '交付日历',
        mode === 'week' ? '本周' : '本月',
        '周、月视图同步显示已安排任务；按截止日期归入日历。',
        <div className="week-controls">
          <div className="calendar-mode" aria-label="日历视图">
            <Button
              variant={mode === 'week' ? 'primary' : 'secondary'}
              aria-pressed={mode === 'week'}
              onClick={() => setMode('week')}
            >
              按周
            </Button>
            <Button
              variant={mode === 'month' ? 'primary' : 'secondary'}
              aria-pressed={mode === 'month'}
              onClick={() => setMode('month')}
            >
              按月
            </Button>
          </div>
          <Button
            variant="secondary"
            onClick={() => move(-1)}
            aria-label={mode === 'week' ? '上一周' : '上一月'}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button variant="secondary" onClick={() => setDate(data.today)}>
            {mode === 'week' ? '回到本周' : '回到本月'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => move(1)}
            aria-label={mode === 'week' ? '下一周' : '下一月'}
          >
            <ChevronRight size={18} />
          </Button>
        </div>,
      )}
      {current.isLoading ? (
        <Loading />
      ) : current.isError ? (
        <ErrorBox error={current.error} onRetry={() => current.refetch()} />
      ) : (
        <>
          <div className="week-range">
            {dateLabel(current.data!.start)} — {dateLabel(current.data!.end)} ·{' '}
            {
              current.data!.tasks.filter(
                (t) => t.deadline >= current.data!.start && t.deadline <= current.data!.end,
              ).length
            }{' '}
            项交付
          </div>
          <div className="week-scroll">
            {mode === 'week' ? (
              <div className="week-grid">
                {week.data!.days.map((day, i) => (
                  <section key={day} className={`day-column ${day === data.today ? 'today' : ''}`}>
                    <header>
                      <span>{weekdays[i]}</span>
                      <strong>{day.slice(5)}</strong>
                      <small>{week.data!.tasks.filter((t) => t.deadline === day).length} 项</small>
                    </header>
                    <div className="day-tasks">
                      {week
                        .data!.tasks.filter((t) => t.deadline === day)
                        .map((t) => (
                          <div className="day-task farm-calendar-task" key={t.id}>
                            <button
                              type="button"
                              className="farm-calendar-title"
                              onClick={() => actions.openTask(t.id)}
                            >
                              <strong>{t.title}</strong>
                              <small>
                                {t.owner_name} · {t.project_name || '未归项目'}
                              </small>
                            </button>
                            <div className="farm-calendar-tools">
                              <TaskStatusControl task={t} />
                              <TaskDateControl task={t} today={data.today} />
                            </div>
                          </div>
                        ))}
                      <button
                        className="day-add"
                        onClick={() => actions.newTask({ deadline: day })}
                      >
                        <Plus size={15} /> 安排任务
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="month-grid">
                {weekdays.map((day) => (
                  <div className="month-weekday" key={day}>
                    {day}
                  </div>
                ))}
                {month.data!.days.map((day) => {
                  const dayTasks = month.data!.tasks.filter((t) => t.deadline === day);
                  return (
                    <section
                      key={day}
                      className={`month-day ${day === data.today ? 'today' : ''} ${day.slice(0, 7) !== month.data!.start.slice(0, 7) ? 'outside' : ''}`}
                    >
                      <header>
                        <strong>{day.slice(8)}</strong>
                        <small>{dayTasks.length} 项</small>
                      </header>
                      <div className="month-tasks">
                        {dayTasks.map((t) => (
                          <div
                            key={t.id}
                            className={`month-task month-task-${t.status}`}
                            title={`${t.title} · ${t.owner_name}`}
                          >
                            <button
                              type="button"
                              className="farm-calendar-title"
                              onClick={() => actions.openTask(t.id)}
                            >
                              <span>{t.title}</span>
                              <small>{t.owner_name}</small>
                            </button>
                            <TaskStatusControl task={t} />
                          </div>
                        ))}
                      </div>
                      <button
                        className="month-add"
                        onClick={() => actions.newTask({ deadline: day })}
                        aria-label={`${day} 安排任务`}
                      >
                        <Plus size={14} />
                      </button>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export { SettingsPage } from './settings';
