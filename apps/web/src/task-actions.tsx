import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Clock3, MoreHorizontal } from 'lucide-react';
import { addDays, taskRisk, weekStart } from '../../../packages/shared/src/rules';
import { dateLabel, send, type Overview, type Task } from './api';
import type { OpenTaskDefaults } from './App';
import { Avatar, Button, StatusPill } from './ui';

type Command =
  'start' | 'complete' | 'undo_complete' | 'mark_pending' | 'resume' | 'reopen' | 'reset_to_todo';
type TaskActions = {
  command: (task: Task, action: Command, comment?: string) => Promise<Task | null>;
  edit: (task: Task, values: Record<string, unknown>) => Promise<Task | null>;
  update: (task: Task, latestUpdate: string | null) => Promise<Task | null>;
  risk: (task: Task, flag: boolean, note?: string | null) => Promise<Task | null>;
  busy: (id: string) => boolean;
  error: (id: string) => string;
  clearError: (id: string) => void;
};
const TaskActionContext = createContext<TaskActions | null>(null);

export function useTaskActions() {
  const value = useContext(TaskActionContext);
  if (!value) throw new Error('TaskActionProvider is missing');
  return value;
}

export function TaskActionProvider({
  children,
  onNext,
}: {
  children: ReactNode;
  onNext: (defaults: OpenTaskDefaults) => void;
}) {
  const qc = useQueryClient();
  const pending = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{
    task: Task;
    deadline: number;
    paused: boolean;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!toast || toast.paused) return;
    const timer = window.setTimeout(
      () => setToast((current) => (current?.task.id === toast.task.id ? null : current)),
      Math.max(0, toast.deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  const run = async (
    task: Task,
    fn: () => Promise<Task>,
    completed = false,
  ): Promise<Task | null> => {
    if (pending.current.has(task.id)) return null;
    pending.current.add(task.id);
    setBusyIds([...pending.current]);
    setErrors((current) => ({ ...current, [task.id]: '' }));
    try {
      const saved = await fn();
      await qc.invalidateQueries();
      if (completed) setToast({ task: saved, deadline: Date.now() + 8000, paused: false });
      return saved;
    } catch (error) {
      const message = (error as Error).message;
      setErrors((current) => ({ ...current, [task.id]: message }));
      if ((error as { status?: number }).status === 409) await qc.invalidateQueries();
      return null;
    } finally {
      pending.current.delete(task.id);
      setBusyIds([...pending.current]);
    }
  };
  const command: TaskActions['command'] = (task, action, comment) =>
    run(
      task,
      () =>
        send(`/tasks/${task.id}/command`, 'POST', {
          action,
          version: task.version,
          comment: comment || null,
        }),
      action === 'complete',
    );
  const edit: TaskActions['edit'] = (task, values) =>
    run(task, () => send(`/tasks/${task.id}`, 'PATCH', { version: task.version, ...values }));
  const update: TaskActions['update'] = (task, latestUpdate) =>
    run(task, () =>
      send(`/tasks/${task.id}/update`, 'PATCH', { version: task.version, latestUpdate }),
    );
  const risk: TaskActions['risk'] = (task, flag, note) =>
    run(task, () =>
      send(`/tasks/${task.id}/risk`, 'PATCH', {
        version: task.version,
        riskFlag: flag,
        riskNote: note ?? null,
      }),
    );
  const value: TaskActions = {
    command,
    edit,
    update,
    risk,
    busy: (id) => busyIds.includes(id),
    error: (id) => errors[id] || '',
    clearError: (id) => setErrors((current) => ({ ...current, [id]: '' })),
  };
  const undo = async () => {
    if (!toast) return;
    const restored = await command(toast.task, 'undo_complete');
    if (restored) setToast(null);
    else
      setToast((current) =>
        current
          ? { ...current, paused: true, error: '无法撤销：任务可能已被修改。请打开详情核对。' }
          : current,
      );
  };
  const scheduleNext = (task: Task) => {
    const overview = qc.getQueryData<Overview>(['overview']);
    const memberGroupId = overview?.members.find((member) => member.id === task.owner_id)?.groupId;
    const groupId = overview?.groups.some(
      (group) => group.id === memberGroupId && group.status === 'active',
    )
      ? memberGroupId || undefined
      : undefined;
    onNext({ ownerId: task.owner_id, groupId, projectName: task.project_name || undefined });
    setToast(null);
  };
  return (
    <TaskActionContext.Provider value={value}>
      {children}
      {toast && (
        <div
          className="farm-toast"
          role="status"
          onMouseEnter={() =>
            setToast((current) => (current ? { ...current, paused: true } : current))
          }
          onMouseLeave={() =>
            setToast((current) =>
              current ? { ...current, paused: false, deadline: Date.now() + 8000 } : current,
            )
          }
          onFocusCapture={() =>
            setToast((current) => (current ? { ...current, paused: true } : current))
          }
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setToast((current) =>
                current ? { ...current, paused: false, deadline: Date.now() + 8000 } : current,
              );
          }}
        >
          <Check size={18} aria-hidden="true" />
          <span>
            {toast.task.title} · 已完成{toast.error && <small>{toast.error}</small>}
          </span>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busyIds.includes(toast.task.id)}
          >
            撤销
          </button>
          <button type="button" onClick={() => scheduleNext(toast.task)}>
            安排下一项
          </button>
          <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </TaskActionContext.Provider>
  );
}

const commands: Record<Task['status'], { action: Command; label: string }[]> = {
  todo: [
    { action: 'start', label: '开始任务' },
    { action: 'mark_pending', label: '标记待确认' },
    { action: 'complete', label: '标记完成' },
  ],
  in_progress: [
    { action: 'reset_to_todo', label: '设为未开始' },
    { action: 'mark_pending', label: '标记待确认' },
    { action: 'complete', label: '标记完成' },
  ],
  pending_review: [
    { action: 'resume', label: '继续修改' },
    { action: 'reset_to_todo', label: '设为未开始' },
    { action: 'complete', label: '标记完成' },
  ],
  completed: [{ action: 'reopen', label: '重新打开' }],
};

export function TaskStatusControl({ task }: { task: Task }) {
  const actions = useTaskActions();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="farm-status-trigger"
          aria-label={`${task.title}，当前${task.status === 'pending_review' ? '待确认' : task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : '未开始'}，修改状态`}
          disabled={actions.busy(task.id)}
        >
          <StatusPill status={task.status} />
          <ChevronDown size={13} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="farm-popover" sideOffset={6} align="start">
          <strong>更新状态</strong>
          {commands[task.status].map((item) => (
            <button
              type="button"
              key={item.action}
              disabled={actions.busy(task.id)}
              onClick={async () => {
                if (await actions.command(task, item.action)) setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
          {actions.error(task.id) && <small className="form-error">{actions.error(task.id)}</small>}
          <Popover.Arrow className="farm-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TaskDateControl({ task, today }: { task: Task; today: string }) {
  const actions = useTaskActions();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(task.deadline);
  useEffect(() => {
    if (!open) setDate(task.deadline);
  }, [task.deadline, open]);
  const save = async (next: string) => {
    if (!next || next === task.deadline) {
      setOpen(false);
      return;
    }
    if (await actions.edit(task, { deadline: next })) setOpen(false);
  };
  const risk = taskRisk(task, today);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`farm-date-trigger ${risk.overdueDays ? 'text-red' : ''}`}
          aria-label={`${task.title}，截止 ${dateLabel(task.deadline)}，修改截止日`}
          disabled={actions.busy(task.id)}
        >
          <Clock3 size={15} aria-hidden="true" />
          {dateLabel(task.deadline)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="farm-popover farm-date-popover" sideOffset={6} align="end">
          <strong>修改截止日</strong>
          <div className="farm-date-shortcuts">
            <button type="button" disabled={actions.busy(task.id)} onClick={() => void save(today)}>
              今天
            </button>
            <button
              type="button"
              disabled={actions.busy(task.id)}
              onClick={() => void save(addDays(today, 1))}
            >
              明天
            </button>
            <button
              type="button"
              disabled={actions.busy(task.id)}
              onClick={() => void save(addDays(weekStart(today), 7))}
            >
              下周一
            </button>
          </div>
          <label>
            选择日期
            <input
              type="date"
              value={date}
              disabled={actions.busy(task.id)}
              onChange={(event) => setDate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void save(date);
                }
              }}
            />
          </label>
          <Button disabled={actions.busy(task.id) || !date} onClick={() => void save(date)}>
            {actions.busy(task.id) ? '保存中…' : '保存日期'}
          </Button>
          {actions.error(task.id) && (
            <small className="form-error">{actions.error(task.id)}，所选日期已保留</small>
          )}
          <Popover.Arrow className="farm-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TaskMoreControl({ task }: { task: Task }) {
  const actions = useTaskActions();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState(task.latest_update || '');
  const [riskNote, setRiskNote] = useState(task.risk_note || '');
  useEffect(() => {
    if (!open) {
      setLatest(task.latest_update || '');
      setRiskNote(task.risk_note || '');
    }
  }, [task.latest_update, task.risk_note, open]);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="farm-more-trigger"
          aria-label={`${task.title}，更多操作`}
          disabled={actions.busy(task.id)}
        >
          <MoreHorizontal size={20} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="farm-popover farm-more-popover" sideOffset={6} align="end">
          <strong>进展与风险</strong>
          <label>
            当前进展
            <textarea
              value={latest}
              maxLength={280}
              rows={2}
              disabled={actions.busy(task.id)}
              placeholder="一句话记录现在做到哪一步"
              onChange={(event) => setLatest(event.target.value)}
            />
          </label>
          <Button
            disabled={actions.busy(task.id) || latest.trim() === (task.latest_update || '')}
            onClick={async () => {
              if (await actions.update(task, latest.trim() || null)) setOpen(false);
            }}
          >
            {actions.busy(task.id) ? '保存中…' : '保存进展'}
          </Button>
          {task.status !== 'completed' && (
            <>
              <div className="farm-menu-separator" />
              <label>
                可能延期原因（可选）
                <textarea
                  value={riskNote}
                  maxLength={200}
                  rows={2}
                  disabled={actions.busy(task.id)}
                  placeholder="写下需要留意的原因"
                  onChange={(event) => setRiskNote(event.target.value)}
                />
              </label>
              {!task.risk_flag ? (
                <button
                  type="button"
                  disabled={actions.busy(task.id)}
                  onClick={async () => {
                    if (await actions.risk(task, true, riskNote.trim() || null)) setOpen(false);
                  }}
                >
                  标记可能延期
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={actions.busy(task.id)}
                    onClick={async () => {
                      if (await actions.risk(task, false)) setOpen(false);
                    }}
                  >
                    解除可能延期
                  </button>
                  <Button
                    variant="secondary"
                    disabled={actions.busy(task.id) || riskNote.trim() === (task.risk_note || '')}
                    onClick={async () => {
                      if (await actions.risk(task, true, riskNote.trim() || null)) setOpen(false);
                    }}
                  >
                    保存原因
                  </Button>
                </>
              )}
            </>
          )}
          {actions.error(task.id) && (
            <small className="form-error">{actions.error(task.id)}，输入已保留</small>
          )}
          <Popover.Arrow className="farm-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function FarmTaskRow({
  task,
  today,
  onOpen,
  compact = false,
}: {
  task: Task;
  today: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const actions = useTaskActions();
  const risk = taskRisk(task, today);
  return (
    <div className={`farm-task-row ${compact ? 'farm-task-row-compact' : ''}`}>
      <div className="farm-task-title-cell">
        <button type="button" className="farm-task-title" onClick={onOpen}>
          {task.title}
        </button>
        <span className="farm-task-subtitle">
          {task.project_name?.trim() || '未归项目'}
          {task.latest_update ? ` · ${task.latest_update}` : ''}
        </span>
        {risk.reasons.length > 0 && (
          <span className="farm-risk-list">
            {risk.reasons.slice(0, 2).map((reason, index) => (
              <small
                className={`farm-risk-label farm-risk-${risk.codes[index]}`}
                key={risk.codes[index]}
              >
                {reason}
                {risk.overdueDays && index === 0 ? ` ${risk.overdueDays} 天` : ''}
              </small>
            ))}
          </span>
        )}
        {actions.error(task.id) && <small className="form-error">{actions.error(task.id)}</small>}
      </div>
      <span className="farm-task-owner">
        <Avatar
          name={task.owner_name || task.owner?.name || '员'}
          mediaId={task.owner_avatar_id || task.owner?.avatarId}
        />
        {task.owner_name || task.owner?.name || '未指定'}
      </span>
      <TaskStatusControl task={task} />
      <TaskDateControl task={task} today={today} />
      <div className="farm-task-actions">
        {task.status !== 'completed' && (
          <button
            type="button"
            className="farm-complete"
            aria-label={`标记完成：${task.title}`}
            disabled={actions.busy(task.id)}
            onClick={async () => {
              const saved = await actions.command(task, 'complete');
              if (saved)
                window.setTimeout(
                  () => document.querySelector<HTMLButtonElement>('.farm-toast button')?.focus(),
                  0,
                );
            }}
          >
            <Check size={17} aria-hidden="true" />
            {actions.busy(task.id) ? '保存中…' : '标记完成'}
          </button>
        )}
        {task.status === 'completed' && (
          <span className="farm-completed-label">
            <Check size={15} />
            已完成
          </span>
        )}
        <TaskMoreControl task={task} />
      </div>
    </div>
  );
}
