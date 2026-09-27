import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, Plus, Search, Sprout } from 'lucide-react';
import { daysBetweenBusinessDates, taskRisk } from '../../../packages/shared/src/rules';
import {
  api,
  dateLabel,
  memberStatusNames,
  statusNames,
  type Member,
  type Overview,
  type Task,
} from './api';
import type { OpenTaskDefaults } from './App';
import { Avatar, Button, ErrorBox, Loading, StatusPill, WorkPill } from './ui';
import { FarmTaskRow } from './task-actions';

type Actions = {
  openTask: (id: string) => void;
  openMember: (id: string) => void;
  newTask: (defaults?: OpenTaskDefaults) => void;
};
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${day}T12:00:00Z`));
const groupTasks = (tasks: Task[], today: string) =>
  [...tasks].sort((a, b) => {
    const ra = taskRisk(a, today).rank;
    const rb = taskRisk(b, today).rank;
    return ra - rb || a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id);
  });

export function FarmMemberRow({
  member,
  data,
  actions,
  leader = false,
}: {
  member: Member;
  data: Overview;
  actions: Actions;
  leader?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const tasks = groupTasks(member.current_tasks || [], data.today);
  const first = tasks[0];
  const activeGroup = data.groups.find(
    (group) => group.id === member.groupId && group.status === 'active',
  );
  return (
    <div className="farm-member-row">
      <button type="button" className="farm-person" onClick={() => actions.openMember(member.id)}>
        <Avatar name={member.name} mediaId={member.avatarId} />
        <span>
          <strong>
            {member.name}
            {leader && <em>组长</em>}
          </strong>
          <small>{member.position || member.groupName || '未填写职位'}</small>
        </span>
      </button>
      <div className="farm-person-work">
        {first ? (
          <>
            <button type="button" onClick={() => actions.openTask(first.id)} title={first.title}>
              {first.title}
            </button>
            {first.owner_id !== member.id && <small className="farm-collab">协作</small>}
            {tasks.length > 1 && (
              <button
                type="button"
                className="farm-extra"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                另有 {tasks.length - 1} 项{' '}
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </>
        ) : (
          <span className="muted">可以安排新任务</span>
        )}
        {expanded &&
          tasks.slice(1).map((task) => (
            <button
              type="button"
              key={task.id}
              className="farm-extra-task"
              onClick={() => actions.openTask(task.id)}
            >
              {task.title}
              {task.owner_id !== member.id ? ' · 协作' : ''}
            </button>
          ))}
      </div>
      <span className="farm-member-status">
        {member.status === 'active' ? (
          <WorkPill state={member.work_state} />
        ) : (
          memberStatusNames[member.status]
        )}
      </span>
      <span className="farm-member-date">{first ? dateLabel(first.deadline) : '—'}</span>
      {member.status === 'active' && (
        <button
          type="button"
          className="farm-assign"
          onClick={() => actions.newTask({ ownerId: member.id, groupId: activeGroup?.id })}
        >
          分配任务
        </button>
      )}
    </div>
  );
}

export function OverviewPage({ data, actions }: { data: Overview; actions: Actions }) {
  const attention = data.attention.slice(0, 3);
  const upcoming = data.upcoming.slice(0, 3);
  const upcomingProjects = new Map<string, Task[]>();
  for (const task of upcoming) {
    const project = task.project_name?.trim() || '未归项目';
    upcomingProjects.set(project, [...(upcomingProjects.get(project) || []), task]);
  }
  const active = data.members.filter((member) => member.status === 'active');
  const assigned = active.filter((member) => member.current_tasks?.length);
  const groups = data.groups;
  const ungrouped = active.filter((member) => !member.groupId);
  const weekDays = [...new Set(data.weekTasks.map((task) => task.deadline))].sort();
  return (
    <div className="farm-dashboard-page">
      <div className="farm-welcome">
        <div>
          <h1>今天，慢慢把事情做好</h1>
          <p>
            {dayLabel(data.today)} <span aria-hidden="true">·</span>{' '}
            <Link to="/team">{active.length} 位伙伴</Link> <span aria-hidden="true">·</span>{' '}
            <Link to="/tasks?status=unfinished">{data.counts.unfinished ?? 0} 项未完成</Link>{' '}
            <span aria-hidden="true">·</span>{' '}
            <Link to="/tasks?status=unfinished&attention=all">{data.counts.attention} 项需留意</Link>
          </p>
        </div>
        <Button onClick={() => actions.newTask({})}>
          <Plus size={19} /> 新任务
        </Button>
      </div>
      <div className="farm-dashboard-grid">
        <div className="farm-dashboard-main">
          <section className="farm-panel farm-attention-panel" aria-labelledby="attention-title">
            <div className="farm-wood-title">
              <h2 id="attention-title">今天需要留意</h2>
              <span>{data.attention.length} 项</span>
            </div>
            {attention.length ? (
              <>
                <div className="farm-list-head farm-task-head">
                  <span>项目 / 任务</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>截止日</span>
                  <span>操作</span>
                </div>
                {attention.map((task) => (
                  <FarmTaskRow
                    key={task.id}
                    task={task}
                    today={data.today}
                    onOpen={() => actions.openTask(task.id)}
                  />
                ))}
                <Link className="farm-panel-link" to="/tasks?status=unfinished&attention=today">
                  查看全部 {data.attention.length} 项 <ArrowRight size={16} />
                </Link>
              </>
            ) : (
              <div className="farm-empty">
                <img src="/assets/farm/sprout.png" alt="" />
                <strong>目前没有需要留意的交付</strong>
                <span>正常任务仍会在下方成员和日历中显示。</span>
              </div>
            )}
          </section>
          <section className="farm-panel farm-people-panel" aria-labelledby="people-title">
            <div className="farm-wood-title">
              <h2 id="people-title">谁在做什么</h2>
              <span>{active.length} 位伙伴</span>
            </div>
            {active.length ? (
              <>
                <div className="farm-list-head farm-people-head">
                  <span>成员</span>
                  <span>当前任务</span>
                  <span>状态</span>
                  <span>最近截止</span>
                  <span>操作</span>
                </div>
                {groups.map((group) => {
                  const people = active.filter((member) => member.groupId === group.id);
                  return people.length ? (
                    <div className="farm-person-group" key={group.id}>
                      <h3>
                        {group.name}{' '}
                        <small>
                          {people.length} 人{group.status === 'disabled' ? ' · 小组已停用' : ''}
                        </small>
                      </h3>
                      {people.map((member) => (
                        <FarmMemberRow
                          key={member.id}
                          member={member}
                          data={data}
                          actions={actions}
                          leader={group.leaderId === member.id}
                        />
                      ))}
                    </div>
                  ) : null;
                })}
                {ungrouped.length > 0 && (
                  <div className="farm-person-group">
                    <h3>
                      未分组 <small>{ungrouped.length} 人</small>
                    </h3>
                    {ungrouped.map((member) => (
                      <FarmMemberRow
                        key={member.id}
                        member={member}
                        data={data}
                        actions={actions}
                      />
                    ))}
                  </div>
                )}
                {assigned.length === 0 && (
                  <p className="farm-hint">还没有正在处理的任务，可以从成员行分配第一项。</p>
                )}
              </>
            ) : (
              <div className="farm-empty">
                <img src="/assets/farm/sprout.png" alt="" />
                <strong>先添加伙伴，再安排工作</strong>
                <Link to="/team">
                  前往团队 <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </section>
        </div>
        <aside className="farm-dashboard-side">
          <section className="farm-panel farm-upcoming-panel" aria-labelledby="upcoming-title">
            <div className="farm-wood-title">
              <h2 id="upcoming-title">未来三天交付</h2>
              <span>{data.upcoming.length} 项</span>
            </div>
            {upcoming.length ? (
              <>
                <p className="farm-upcoming-note">这些项目有任务即将截止</p>
                {[...upcomingProjects].map(([project, tasks]) => (
                  <div className="farm-upcoming-project" key={project}>
                    <h3>{project}</h3>
                    {tasks.map((task) => {
                      const days = daysBetweenBusinessDates(data.today, task.deadline);
                      return (
                        <button
                          type="button"
                          className="farm-upcoming-task"
                          key={task.id}
                          onClick={() => actions.openTask(task.id)}
                        >
                          <strong>{task.title}</strong>
                          <span>
                            {task.owner_name} · {dateLabel(task.deadline)}
                            <em>{days === 1 ? '明天' : days === 2 ? '后天' : '3 天后'}</em>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                <Link
                  className="farm-panel-link"
                  to="/tasks?status=unfinished&attention=upcoming"
                >
                  查看全部 {data.upcoming.length} 项 <ArrowRight size={16} />
                </Link>
              </>
            ) : (
              <div className="farm-empty farm-empty-small">
                <img src="/assets/farm/sprout.png" alt="" />
                <strong>未来三天暂无待交付任务</strong>
              </div>
            )}
          </section>
          <section className="farm-panel farm-week-panel" aria-labelledby="week-title">
            <div className="farm-wood-title">
              <h2 id="week-title">本周交付</h2>
            </div>
            {weekDays.length ? (
              weekDays.map((day) => (
                <div className="farm-week-day" key={day}>
                  <h3>
                    {dayLabel(day)}
                    {day === data.today && <small>今天</small>}
                  </h3>
                  {data.weekTasks
                    .filter((task) => task.deadline === day)
                    .map((task) => (
                      <button
                        type="button"
                        className={`farm-week-task ${task.status === 'completed' ? 'is-complete' : ''}`}
                        key={task.id}
                        onClick={() => actions.openTask(task.id)}
                      >
                        <span className={`farm-status-dot farm-status-${task.status}`} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.owner_name}</small>
                        </span>
                      </button>
                    ))}
                </div>
              ))
            ) : (
              <div className="farm-empty farm-empty-small">
                <img src="/assets/farm/sprout.png" alt="" />
                <strong>本周还没有交付</strong>
              </div>
            )}
            <Link className="farm-panel-link" to="/week">
              查看日历 <ArrowRight size={16} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

type ProjectSummary = {
  key: string;
  name: string;
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  pending: number;
  tasks: Task[];
};
export function TasksPage({ data, actions }: { data: Overview; actions: Actions }) {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'unfinished';
  const attention = params.get('attention') || (params.get('riskOnly') === 'true' ? 'all' : '');
  const view = params.get('view') === 'project' ? 'project' : 'list';
  const query = new URLSearchParams(params);
  query.delete('view');
  if (status === 'all') query.delete('status');
  else query.set('status', status);
  const scope = new URLSearchParams();
  for (const key of ['groupId', 'memberId', 'search'])
    if (params.get(key)) scope.set(key, params.get(key)!);
  const tasks = useQuery({
    queryKey: ['tasks', query.toString()],
    queryFn: () => api<Task[]>(`/tasks?${query}`),
  });
  const scopeTasks = useQuery({
    queryKey: ['tasks-scope', scope.toString()],
    queryFn: () => api<Task[]>(`/tasks?${scope}`),
  });
  const set = (key: string, value: string, clearWhen = '') => {
    const next = new URLSearchParams(params);
    if (value === clearWhen) next.delete(key);
    else next.set(key, value);
    setParams(next, { preventScrollReset: true });
  };
  const projects = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const task of scopeTasks.data || []) {
      const key = task.project_name?.trim() || '';
      const item = map.get(key) || {
        key,
        name: key || '未归项目',
        total: 0,
        completed: 0,
        inProgress: 0,
        todo: 0,
        pending: 0,
        tasks: [],
      };
      item.total++;
      if (task.status === 'completed') item.completed++;
      else if (task.status === 'in_progress') item.inProgress++;
      else if (task.status === 'pending_review') item.pending++;
      else item.todo++;
      item.tasks.push(task);
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [scopeTasks.data]);
  const filteredProjects = projects.filter((project) =>
    tasks.data?.some((task) => (task.project_name?.trim() || '') === project.key),
  );
  const projectOptions = projects.map((project) => ({ key: project.key, name: project.name }));
  return (
    <div className="farm-tasks-page">
      <div className="page-head">
        <div>
          <h1>任务</h1>
          <p>直接更新状态、截止日与进展；项目完成数量来自当前范围内的真实任务。</p>
        </div>
        <div className="farm-view-toggle" role="group" aria-label="任务查看方式">
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => set('view', 'list', 'list')}
          >
            任务列表
          </button>
          <button
            type="button"
            aria-pressed={view === 'project'}
            onClick={() => set('view', 'project', 'list')}
          >
            按项目查看
          </button>
        </div>
      </div>
      <div className="farm-filterbar">
        <label className="farm-search">
          <Search size={17} />
          <input
            aria-label="搜索标题或项目"
            value={params.get('search') || ''}
            placeholder="搜索任务或项目"
            onChange={(event) => set('search', event.target.value)}
          />
        </label>
        <select
          aria-label="筛选状态"
          value={status}
          onChange={(event) => set('status', event.target.value, 'unfinished')}
        >
          <option value="unfinished">未完成</option>
          <option value="all">全部</option>
          {Object.entries(statusNames).map(([key, value]) => (
            <option value={key} key={key}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选小组"
          value={params.get('groupId') || ''}
          onChange={(event) => set('groupId', event.target.value)}
        >
          <option value="">全部小组</option>
          {data.groups.map((group) => (
            <option value={group.id} key={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选成员"
          value={params.get('memberId') || ''}
          onChange={(event) => set('memberId', event.target.value)}
        >
          <option value="">全部成员</option>
          {data.members.map((member) => (
            <option value={member.id} key={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选项目"
          value={
            params.has('projectName')
              ? params.get('projectName') === ''
                ? '__none__'
                : `project:${encodeURIComponent(params.get('projectName')!)}`
              : '__all__'
          }
          onChange={(event) => {
            const next = new URLSearchParams(params);
            if (event.target.value === '__all__') next.delete('projectName');
            else
              next.set(
                'projectName',
                event.target.value === '__none__'
                  ? ''
                  : decodeURIComponent(event.target.value.slice('project:'.length)),
              );
            setParams(next, { preventScrollReset: true });
          }}
        >
          <option value="__all__">全部项目</option>
          {projectOptions.map((project) => (
            <option
              value={project.key ? `project:${encodeURIComponent(project.key)}` : '__none__'}
              key={project.key || '__none__'}
            >
              {project.name}
            </option>
          ))}
        </select>
        <label className="farm-risk-checkbox">
          <input
            type="checkbox"
            checked={!!attention}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.delete('riskOnly');
              if (event.target.checked) next.set('attention', 'all');
              else next.delete('attention');
              setParams(next, { preventScrollReset: true });
            }}
          />
          仅看需留意
        </label>
        {attention && (
          <select
            aria-label="需留意范围"
            value={attention}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.delete('riskOnly');
              next.set('attention', event.target.value);
              setParams(next, { preventScrollReset: true });
            }}
          >
            <option value="all">全部需留意</option>
            <option value="today">今天需要留意</option>
            <option value="upcoming">未来三天交付</option>
          </select>
        )}
      </div>
      {tasks.isLoading || scopeTasks.isLoading ? (
        <Loading />
      ) : tasks.isError ? (
        <ErrorBox error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : scopeTasks.isError ? (
        <ErrorBox error={scopeTasks.error} onRetry={() => scopeTasks.refetch()} />
      ) : (
        <>
          <p className="farm-scope-note">
            当前范围：{scopeTasks.data?.length || 0} 项任务 · 当前筛选显示 {tasks.data?.length || 0}{' '}
            项
          </p>
          {tasks.data?.length ? (
            view === 'project' ? (
              <div className="farm-projects">
                {filteredProjects.map((project) => (
                  <section className="farm-panel farm-project-panel" key={project.key}>
                    <div className="farm-wood-title">
                      <h2>{project.name}</h2>
                      <button
                        type="button"
                        onClick={() => actions.newTask({ projectName: project.key || undefined })}
                      >
                        <Plus size={15} /> 新任务
                      </button>
                    </div>
                    <div className="farm-project-summary">
                      <strong>
                        已完成 {project.completed}/{project.total} 项
                      </strong>
                      <span>
                        当前范围 · 进行中 {project.inProgress} · 未开始 {project.todo} · 待确认{' '}
                        {project.pending}
                      </span>
                    </div>
                    <div
                      className="farm-progress-track"
                      aria-label={`${project.name} 已完成 ${project.completed}/${project.total} 项`}
                    >
                      {(['completed', 'inProgress', 'pending', 'todo'] as const).map((key) => (
                        <span
                          key={key}
                          className={`farm-segment farm-segment-${key}`}
                          style={{ width: `${(project[key] / project.total) * 100}%` }}
                        />
                      ))}
                    </div>
                    <div className="farm-list-head farm-task-head">
                      <span>项目 / 任务</span>
                      <span>负责人</span>
                      <span>状态</span>
                      <span>截止日</span>
                      <span>操作</span>
                    </div>
                    {tasks.data
                      .filter((task) => (task.project_name?.trim() || '') === project.key)
                      .map((task) => (
                        <FarmTaskRow
                          task={task}
                          today={data.today}
                          key={task.id}
                          onOpen={() => actions.openTask(task.id)}
                        />
                      ))}
                  </section>
                ))}
              </div>
            ) : (
              <section className="farm-panel farm-task-list">
                <div className="farm-wood-title">
                  <h2>任务列表</h2>
                  <span>{tasks.data.length} 项</span>
                </div>
                <div className="farm-list-head farm-task-head">
                  <span>项目 / 任务</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>截止日</span>
                  <span>操作</span>
                </div>
                {tasks.data.map((task) => (
                  <FarmTaskRow
                    task={task}
                    today={data.today}
                    key={task.id}
                    onOpen={() => actions.openTask(task.id)}
                  />
                ))}
              </section>
            )
          ) : (
            <div className="farm-panel farm-empty">
              <img src="/assets/farm/sprout.png" alt="" />
              <strong>没有符合条件的任务</strong>
              <span>试试调整筛选，或创建一项新任务。</span>
              <Button onClick={() => actions.newTask({})}>新任务</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
