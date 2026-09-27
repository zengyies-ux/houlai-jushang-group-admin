import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowRight, Check, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  api,
  send,
  statusNames,
  memberStatusNames,
  dateLabel,
  imageDataUrl,
  type Overview,
  type Task,
  type Member,
} from './api';
import {
  Button,
  Drawer,
  Field,
  StatusPill,
  Pill,
  Empty,
  ErrorBox,
  Loading,
  Confirm,
  Avatar,
} from './ui';
import { taskInput } from '../../../packages/shared/src/validation';
import type { OpenTaskDefaults } from './App';
import {
  TaskDateControl,
  TaskMoreControl,
  TaskStatusControl,
  useTaskActions,
} from './task-actions';

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries();
const closeGuard = (dirty: boolean, close: () => void) => {
  if (!dirty || window.confirm('有未保存的修改，确定丢弃吗？')) close();
};
export function GroupFormDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient(),
    [error, setError] = useState('');
  const f = useForm<{ name: string; type: string; notes: string }>({
    defaultValues: { name: '', type: '', notes: '' },
  });
  const save = f.handleSubmit(async (x) => {
    setError('');
    try {
      await send('/groups', 'POST', x);
      await invalidate(qc);
      f.reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <Drawer
      open={open}
      onOpenChange={(v) => !v && closeGuard(f.formState.isDirty, onClose)}
      title="新建小组"
      subtitle="名称是唯一必填项。"
      footer={
        <Button onClick={save} disabled={f.formState.isSubmitting}>
          保存小组
        </Button>
      }
    >
      <div className="form-stack">
        <Field label="小组名称">
          <input {...f.register('name', { required: true })} placeholder="例如：制作一组" />
        </Field>
        <Field label="类型（可选）">
          <input {...f.register('type')} placeholder="例如：动画制作" />
        </Field>
        <Field label="备注（可选）">
          <textarea {...f.register('notes')} />
        </Field>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Drawer>
  );
}
export function GroupManageDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient(),
    overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') }),
    tasks = useQuery({
      queryKey: ['groupTasks', id],
      queryFn: () => api<Task[]>(`/tasks?groupId=${id}`),
      enabled: !!id,
    });
  const g = overview.data?.groups.find((x) => x.id === id);
  const [name, setName] = useState(''),
    [type, setType] = useState(''),
    [notes, setNotes] = useState(''),
    [leader, setLeader] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (g) {
      setName(g.name);
      setType(g.type || '');
      setNotes(g.notes || '');
      setLeader(g.leaderId || '');
    }
  }, [g]);
  const save = async (payload: unknown) => {
    if (!g) return;
    setBusy(true);
    setError('');
    try {
      await send(`/groups/${g.id}`, 'PATCH', payload);
      await invalidate(qc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const outstanding = tasks.data?.filter((t) => t.status !== 'completed') || [];
  return (
    <Drawer
      open={!!id}
      onOpenChange={(v) => !v && onClose()}
      title={g?.name || '小组管理'}
      subtitle="调整小组信息与组长。"
    >
      <div className="form-stack">
        <Field label="小组名称">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="类型">
          <input value={type} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="组长">
          <select value={leader} onChange={(e) => setLeader(e.target.value)}>
            <option value="">待指定</option>
            {overview.data?.members
              .filter((m) => m.groupId === id && m.status === 'active')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="备注">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button
          disabled={busy || !name.trim()}
          onClick={() =>
            save({ name, type: type || null, notes: notes || null, leaderId: leader || null })
          }
        >
          保存小组信息
        </Button>
        {error && <p className="form-error">{error}</p>}
        <section>
          <h3>小组状态</h3>
          <p className="muted">停用后不再用于新成员或新任务。现有成员与任务仍保留并可查看。</p>
          {outstanding.length > 0 && (
            <div className="notice">
              仍有 {outstanding.length} 项未完成任务：
              {outstanding
                .slice(0, 3)
                .map((t) => t.title)
                .join('、')}
              {outstanding.length > 3 ? '…' : ''}。可在任务详情转交。
            </div>
          )}
          {g?.status === 'active' ? (
            <Confirm
              trigger={
                <Button variant="ghost" disabled={busy}>
                  停用小组
                </Button>
              }
              title="停用这个小组？"
              description="现有成员与任务继续保留；新建任务和新成员不能选择停用小组。"
              onConfirm={() => save({ status: 'disabled' })}
            />
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => save({ status: 'active' })}>
              恢复小组
            </Button>
          )}
        </section>
      </div>
    </Drawer>
  );
}
export function MemberFormDrawer({
  open,
  initialGroupId,
  onClose,
  today,
}: {
  open: boolean;
  initialGroupId?: string;
  onClose: () => void;
  today: string;
}) {
  const qc = useQueryClient(),
    overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') }),
    [error, setError] = useState('');
  const f = useForm<any>({
    defaultValues: {
      name: '',
      nickname: '',
      position: '',
      groupId: initialGroupId || '',
      joinedAt: today,
      notes: '',
    },
  });
  useEffect(() => {
    if (open)
      f.reset({
        name: '',
        nickname: '',
        position: '',
        groupId: initialGroupId || '',
        joinedAt: today,
        notes: '',
      });
  }, [open, initialGroupId, today]);
  const save = f.handleSubmit(async (x) => {
    setError('');
    try {
      await send('/members', 'POST', { ...x, groupId: x.groupId || null });
      await invalidate(qc);
      f.reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <Drawer
      open={open}
      onOpenChange={(v) => !v && closeGuard(f.formState.isDirty, onClose)}
      title="新增成员"
      subtitle="职位自由填写，不需要先建立字典。"
      footer={
        <Button onClick={save} disabled={f.formState.isSubmitting}>
          保存成员
        </Button>
      }
    >
      <div className="form-stack">
        <Field label="姓名">
          <input {...f.register('name', { required: true })} placeholder="成员姓名" />
        </Field>
        <Field label="职位">
          <input {...f.register('position')} list="position-options" placeholder="例如：剪辑" />
        </Field>
        <datalist id="position-options">
          {[...new Set(overview.data?.members.map((m) => m.position).filter(Boolean))].map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Field label="所属小组">
          <select {...f.register('groupId')}>
            <option value="">暂不分组</option>
            {overview.data?.groups
              .filter((g) => g.status === 'active')
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </Field>
        <details className="more">
          <summary>更多信息</summary>
          <Field label="昵称">
            <input {...f.register('nickname')} />
          </Field>
          <Field label="加入日期">
            <input type="date" {...f.register('joinedAt')} />
          </Field>
          <Field label="备注">
            <textarea {...f.register('notes')} />
          </Field>
        </details>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Drawer>
  );
}
export function MemberDrawer({
  id,
  onClose,
  actions,
}: {
  id: string | null;
  onClose: () => void;
  actions: { openTask: (id: string) => void; newTask: (d?: OpenTaskDefaults) => void };
}) {
  const qc = useQueryClient(),
    data = useQuery({
      queryKey: ['member', id],
      queryFn: () => api<Member>(`/members/${id}`),
      enabled: !!id,
    }),
    overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') }),
    [error, setError] = useState(''),
    [edit, setEdit] = useState(false),
    [groupId, setGroupId] = useState(''),
    [status, setStatus] = useState('active'),
    [position, setPosition] = useState(''),
    [memberName, setMemberName] = useState(''),
    [photoBusy, setPhotoBusy] = useState(false);
  useEffect(() => {
    if (data.data) {
      setGroupId(data.data.groupId || '');
      setStatus(data.data.status);
      setPosition(data.data.position);
      setMemberName(data.data.name);
    }
  }, [data.data]);
  const m = data.data;
  const uploadAvatar = async (file?: File) => {
    if (!m || !file) return;
    setPhotoBusy(true);
    setError('');
    try {
      const image = await imageDataUrl(file, 2 * 1024 * 1024);
      await send(`/members/${m.id}/avatar`, 'PUT', { image });
      await invalidate(qc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  };
  const removeAvatar = async () => {
    if (!m) return;
    setPhotoBusy(true);
    setError('');
    try {
      await send(`/members/${m.id}/avatar`, 'DELETE', {});
      await invalidate(qc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  };
  const save = async () => {
    if (!m) return;
    setError('');
    try {
      await send(`/members/${m.id}`, 'PATCH', {
        name: memberName,
        groupId: groupId || null,
        status,
        position,
      });
      await invalidate(qc);
      setEdit(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const leader = async () => {
    if (!m?.groupId) return;
    try {
      await send(`/groups/${m.groupId}`, 'PATCH', { leaderId: m.id });
      await invalidate(qc);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Drawer
      open={!!id}
      onOpenChange={(v) => !v && onClose()}
      title={m?.name || '成员详情'}
      subtitle={m ? `${m.position || '未填写职位'} · ${memberStatusNames[m.status]}` : undefined}
    >
      {data.isLoading ? (
        <Loading />
      ) : data.isError ? (
        <ErrorBox error={data.error} onRetry={() => data.refetch()} />
      ) : (
        m && (
          <div className="detail-stack">
            <div className="member-profile">
              <Avatar name={m.name} mediaId={m.avatarId} large />
              <div>
                <strong>{m.name}</strong>
                <small>PNG、JPEG 或 WebP，最多 2 MB。头像随备份保存。</small>
                <div className="head-actions">
                  <input
                    className="image-file-input"
                    aria-label={`上传${m.name}头像`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={photoBusy}
                    onChange={(e) => {
                      void uploadAvatar(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  {m.avatarId && (
                    <Button variant="ghost" disabled={photoBusy} onClick={removeAvatar}>
                      移除头像
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="detail-actions">
              <Button
                onClick={() => {
                  onClose();
                  actions.newTask({
                    ownerId: m.id,
                    groupId:
                      overview.data?.groups.find((g) => g.id === m.groupId)?.status === 'active'
                        ? m.groupId || undefined
                        : undefined,
                  });
                }}
                disabled={m.status !== 'active'}
              >
                <Plus size={16} /> 分配任务
              </Button>
              <Button variant="secondary" onClick={() => setEdit(!edit)}>
                {edit ? '取消编辑' : m.groupId ? '编辑成员' : '分配小组 / 编辑'}
              </Button>
              {m.groupId && m.status === 'active' && (
                <Button variant="ghost" onClick={leader}>
                  设为组长
                </Button>
              )}
            </div>
            {edit && (
              <div className="inline-edit">
                <Field label="姓名">
                  <input value={memberName} onChange={(e) => setMemberName(e.target.value)} />
                </Field>
                <Field label="职位">
                  <input value={position} onChange={(e) => setPosition(e.target.value)} />
                </Field>
                <Field label="所属小组">
                  <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="">未分组</option>
                    {overview.data?.groups
                      .filter((g) => g.status === 'active' || g.id === m.groupId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="在职状态">
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="active">在职</option>
                    <option value="paused">暂停</option>
                    <option value="left">离组</option>
                  </select>
                </Field>
                {status !== 'active' && m.tasks?.some((t) => t.status !== 'completed') && (
                  <p className="notice">此成员仍参与未完成任务，任务会保留。可在任务详情中转交。</p>
                )}
                <Button onClick={save}>保存修改</Button>
              </div>
            )}
            {error && <p className="form-error">{error}</p>}
            <section>
              <h3>当前任务</h3>
              {m.tasks
                ?.filter(
                  (t) =>
                    t.status !== 'completed' &&
                    (t.owner_id === m.id || t.collaborators?.some((c) => c.id === m.id)),
                )
                .map((t) => (
                  <button
                    className="detail-list-row"
                    key={t.id}
                    onClick={() => {
                      onClose();
                      actions.openTask(t.id);
                    }}
                  >
                    {t.title}
                    <StatusPill status={t.status} />
                  </button>
                ))}
              {!m.tasks?.some((t) => t.status !== 'completed') && <Empty title="暂无当前任务" />}
            </section>
            <section>
              <h3>任务历史</h3>
              {m.tasks
                ?.filter(
                  (t) =>
                    t.status === 'completed' ||
                    (t.owner_id !== m.id && !t.collaborators?.some((c) => c.id === m.id)),
                )
                .map((t) => (
                  <button
                    className="detail-list-row"
                    key={t.id}
                    onClick={() => {
                      onClose();
                      actions.openTask(t.id);
                    }}
                  >
                    {t.title}
                    <span className="muted">{t.owner_id !== m.id ? '曾参与' : '已完成'}</span>
                  </button>
                ))}
            </section>
            <section>
              <h3>组别历史</h3>
              {m.history?.map((h) => (
                <div className="history-row" key={h.id}>
                  <span>{h.group_name_snapshot || '未分组'}</span>
                  <small>
                    {dateLabel(h.started_at)} — {h.ended_at ? dateLabel(h.ended_at) : '至今'}
                  </small>
                </div>
              ))}
            </section>
          </div>
        )
      )}
    </Drawer>
  );
}
export function TaskFormDrawer({
  open,
  defaults,
  onClose,
  today,
}: {
  open: boolean;
  defaults: OpenTaskDefaults;
  onClose: () => void;
  today: string;
}) {
  const qc = useQueryClient(),
    overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') }),
    historyTasks = useQuery({
      queryKey: ['project-options'],
      queryFn: () => api<Task[]>('/tasks'),
    }),
    [error, setError] = useState('');
  const f = useForm<any>({
    resolver: zodResolver(taskInput),
    defaultValues: {
      title: '',
      ownerId: defaults.ownerId || '',
      deadline: defaults.deadline || today,
      projectName: defaults.projectName || '',
      groupId: defaults.groupId || '',
      collaboratorIds: [],
      description: '',
      notes: '',
      startDate: null,
      priority: null,
      progress: null,
    },
  });
  useEffect(() => {
    if (open)
      f.reset({
        title: '',
        ownerId: defaults.ownerId || '',
        deadline: defaults.deadline || today,
        projectName: defaults.projectName || '',
        groupId: defaults.groupId || '',
        collaboratorIds: [],
        description: '',
        notes: '',
        startDate: null,
        priority: null,
        progress: null,
      });
  }, [open, defaults.ownerId, defaults.groupId, defaults.deadline, defaults.projectName, today]);
  const ownerId = f.watch('ownerId');
  const save = f.handleSubmit(
    async (x) => {
      setError('');
      try {
        await send('/tasks', 'POST', {
          ...x,
          groupId: x.groupId || null,
          startDate: x.startDate || null,
          projectName: x.projectName || null,
          description: x.description || null,
          notes: x.notes || null,
          priority: x.priority || null,
          progress: x.progress ?? null,
        });
        await invalidate(qc);
        f.reset();
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    (errors) => setError(String(Object.values(errors)[0]?.message || '请检查填写内容')),
  );
  return (
    <Drawer
      open={open}
      onOpenChange={(v) => !v && closeGuard(f.formState.isDirty, onClose)}
      title="新建任务"
      subtitle="先定任务、负责人和截止日。"
      footer={
        <Button onClick={save} disabled={f.formState.isSubmitting}>
          保存任务
        </Button>
      }
    >
      <div className="form-stack">
        <Field label="任务名称">
          <input {...f.register('title')} placeholder="例如：第一集分镜剪辑" />
        </Field>
        {f.formState.errors.title && <small className="form-error">请填写任务名称</small>}
        <Field label="负责人">
          <select {...f.register('ownerId')}>
            <option value="">选择在职成员</option>
            {overview.data?.members
              .filter((m) => m.status === 'active')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.position}
                </option>
              ))}
          </select>
        </Field>
        <Field label="截止日期">
          <input type="date" {...f.register('deadline')} />
        </Field>
        <Field label="项目 / 短剧名称（可选）">
          <input
            {...f.register('projectName')}
            list="project-options"
            placeholder="例如：晨光短剧"
          />
        </Field>
        <datalist id="project-options">
          {[...new Set(historyTasks.data?.map((t) => t.project_name?.trim()).filter(Boolean))].map(
            (p) => (
              <option key={p!} value={p!} />
            ),
          )}
        </datalist>
        <details className="more">
          <summary>更多信息</summary>
          <Field label="任务所属小组">
            <select {...f.register('groupId', { setValueAs: (v) => v || null })}>
              <option value="">不指定</option>
              {overview.data?.groups
                .filter((g) => g.status === 'active')
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="field">
            <span>协作者</span>
            <div className="checkbox-list">
              {overview.data?.members
                .filter((m) => m.status === 'active' && m.id !== ownerId)
                .map((m) => (
                  <label key={m.id}>
                    <input type="checkbox" value={m.id} {...f.register('collaboratorIds')} />
                    {m.name}
                  </label>
                ))}
            </div>
          </div>
          <Field label="开始日期">
            <input type="date" {...f.register('startDate', { setValueAs: (v) => v || null })} />
          </Field>
          <Field label="优先级">
            <select {...f.register('priority', { setValueAs: (v) => v || null })}>
              <option value="">不指定</option>
              <option value="low">低</option>
              <option value="normal">普通</option>
              <option value="high">高</option>
            </select>
          </Field>
          <Field label="进度（可选）">
            <input
              type="number"
              min="0"
              max="100"
              placeholder="未知时留空"
              {...f.register('progress', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
            />
          </Field>
          <Field label="描述">
            <textarea {...f.register('description')} />
          </Field>
          <Field label="备注">
            <textarea {...f.register('notes')} />
          </Field>
        </details>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Drawer>
  );
}

const eventNames: Record<string, string> = {
  created: '创建任务',
  started: '开始任务',
  completed: '标记完成',
  completion_undone: '撤销本次完成',
  pending_marked: '标记待确认',
  resumed: '继续修改',
  reopened: '重新打开',
  reset_to_todo: '设为未开始',
  update_recorded: '记录进展',
  risk_marked: '标记可能延期',
  risk_cleared: '解除可能延期',
  submitted: '登记提交',
  approved: '验收通过',
  rejected: '打回修改',
  approval_undone: '撤销误验收',
  participants_changed: '调整参与人或小组',
  deadline_changed: '修改截止日期',
  fields_changed: '修改任务信息',
  deleted: '删除任务',
};
type ParticipantSnapshot = {
  owner?: { id: string; name: string };
  collaborators?: { id: string; name: string }[];
  group?: { id: string; name: string } | null;
};
function participantChanges(before?: ParticipantSnapshot, after?: ParticipantSnapshot) {
  if (!before || !after) return [];
  const previous = [before.owner, ...(before.collaborators || [])].filter(
    (member): member is { id: string; name: string } => !!member,
  );
  const next = [after.owner, ...(after.collaborators || [])].filter(
    (member): member is { id: string; name: string } => !!member,
  );
  const previousIds = new Set(previous.map((member) => member.id));
  const nextIds = new Set(next.map((member) => member.id));
  const changes = [];
  if (before.owner?.id !== after.owner?.id)
    changes.push(`负责人：${before.owner?.name || '未指定'} → ${after.owner?.name || '未指定'}`);
  const joined = next.filter((member) => !previousIds.has(member.id));
  const left = previous.filter((member) => !nextIds.has(member.id));
  if (joined.length) changes.push(`加入：${joined.map((member) => member.name).join('、')}`);
  if (left.length) changes.push(`退出：${left.map((member) => member.name).join('、')}`);
  if (before.group?.id !== after.group?.id)
    changes.push(`所属小组：${before.group?.name || '未指定'} → ${after.group?.name || '未指定'}`);
  return changes;
}
export function TaskDrawer({
  id,
  onClose,
  onNext,
}: {
  id: string | null;
  onClose: () => void;
  onNext: (defaults: OpenTaskDefaults) => void;
}) {
  const taskActions = useTaskActions();
  const qc = useQueryClient(),
    task = useQuery({
      queryKey: ['task', id],
      queryFn: () => api<Task>(`/tasks/${id}`),
      enabled: !!id,
    }),
    overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [rosterEdit, setRosterEdit] = useState(false),
    [title, setTitle] = useState(''),
    [deadline, setDeadline] = useState(''),
    [owner, setOwner] = useState(''),
    [group, setGroup] = useState(''),
    [project, setProject] = useState(''),
    [startDate, setStartDate] = useState(''),
    [description, setDescription] = useState(''),
    [notes, setNotes] = useState(''),
    [priority, setPriority] = useState(''),
    [progress, setProgress] = useState(''),
    [collabs, setCollabs] = useState<string[]>([]);
  useEffect(() => {
    if (task.data) {
      const t = task.data;
      if (!edit) {
        setTitle(t.title);
        setDeadline(t.deadline);
        setGroup(t.group_id || '');
        setProject(t.project_name || '');
        setStartDate(t.start_date || '');
        setDescription(t.description || '');
        setNotes(t.notes || '');
        setPriority(t.priority || '');
        setProgress(t.progress === null ? '' : String(t.progress));
      }
      if (!rosterEdit) {
        setOwner(t.owner_id);
        setCollabs(t.collaborators.map((c) => c.id));
      }
    }
  }, [task.data, edit, rosterEdit]);
  useEffect(() => {
    setEdit(false);
    setRosterEdit(false);
  }, [id]);
  const t = task.data;
  const editDirty =
    !!t &&
    edit &&
    (title !== t.title ||
      deadline !== t.deadline ||
      group !== (t.group_id || '') ||
      project !== (t.project_name || '') ||
      startDate !== (t.start_date || '') ||
      description !== (t.description || '') ||
      notes !== (t.notes || '') ||
      priority !== (t.priority || '') ||
      progress !== (t.progress === null ? '' : String(t.progress)));
  const rosterDirty =
    !!t &&
    rosterEdit &&
    (owner !== t.owner_id ||
      JSON.stringify([...collabs].sort()) !==
        JSON.stringify(t.collaborators.map((c) => c.id).sort()));
  const rosterBefore = t ? { owner: t.owner, collaborators: t.collaborators } : undefined;
  const rosterAfter = t
    ? {
        owner: overview.data?.members.find((member) => member.id === owner) || t.owner,
        collaborators: collabs.map(
          (id) =>
            overview.data?.members.find((member) => member.id === id) ||
            t.collaborators.find((member) => member.id === id)!,
        ),
      }
    : undefined;
  const rosterChanges = participantChanges(rosterBefore, rosterAfter);
  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await invalidate(qc);
      await task.refetch();
      return true;
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status === 409) await task.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const command = async (action: 'complete' | 'reopen' | 'undo_complete') => {
    if (!t) return;
    const saved = await taskActions.command(t, action);
    if (saved) await task.refetch();
  };
  const save = () =>
    t &&
    mutate(() =>
      send(`/tasks/${t.id}`, 'PATCH', {
        version: t.version,
        title,
        deadline,
        groupId: group || null,
        projectName: project || null,
        startDate: startDate || null,
        description: description || null,
        notes: notes || null,
        priority: priority || null,
        progress: progress === '' ? null : Number(progress),
      }),
    ).then((ok) => {
      if (ok) setEdit(false);
    });
  const saveRoster = () =>
    t &&
    mutate(() =>
      send(`/tasks/${t.id}`, 'PATCH', {
        version: t.version,
        ownerId: owner,
        collaboratorIds: collabs,
      }),
    ).then((ok) => {
      if (ok) setRosterEdit(false);
    });
  const remove = () =>
    t &&
    mutate(() => send(`/tasks/${t.id}`, 'DELETE', { version: t.version })).then((ok) => {
      if (ok) onClose();
    });
  return (
    <Drawer
      open={!!id}
      onOpenChange={(v) =>
        !v &&
        ((!editDirty && !rosterDirty) || window.confirm('有未保存的修改，确定丢弃吗？')) &&
        onClose()
      }
      title={t?.title || '任务详情'}
      subtitle={t ? `${t.project_name || '未填写项目'} · 截止 ${dateLabel(t.deadline)}` : undefined}
    >
      {task.isLoading ? (
        <Loading />
      ) : task.isError ? (
        <ErrorBox error={task.error} onRetry={() => task.refetch()} />
      ) : (
        t && (
          <div className="detail-stack">
            <div className="task-detail-status">
              <TaskStatusControl task={t} />
              <TaskDateControl task={t} today={overview.data?.today || ''} />
              <TaskMoreControl task={t} />
            </div>
            <div className="detail-facts">
              <div>
                <small>所属小组</small>
                <strong>{t.group?.name || '未指定'}</strong>
              </div>
              <div>
                <small>截止日期</small>
                <strong>{dateLabel(t.deadline)}</strong>
              </div>
            </div>
            <section className="participants-section">
              <div className="section-title">
                <h3>参与人员</h3>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (rosterEdit) {
                      if (rosterDirty && !window.confirm('丢弃未保存的人员调整？')) return;
                      setOwner(t.owner_id);
                      setCollabs(t.collaborators.map((member) => member.id));
                      setRosterEdit(false);
                    } else {
                      if (editDirty && !window.confirm('丢弃未保存的任务信息？')) return;
                      setEdit(false);
                      setRosterEdit(true);
                    }
                  }}
                >
                  {rosterEdit ? '取消调整' : '调整人员'}
                </Button>
              </div>
              <p className="participants-summary">
                负责人：<strong>{t.owner?.name || t.owner_name}</strong> · 协作者：
                <strong>{t.collaborators.map((member) => member.name).join('、') || '暂无'}</strong>
              </p>
              {rosterEdit && (
                <div className="inline-edit">
                  <Field label="新的负责人">
                    <select
                      value={owner}
                      onChange={(event) => {
                        setOwner(event.target.value);
                        setCollabs((current) => current.filter((id) => id !== event.target.value));
                      }}
                    >
                      {overview.data?.members
                        .filter((member) => member.status === 'active' || member.id === t.owner_id)
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <div className="field">
                    <span>继续参与的协作者</span>
                    <small>
                      勾选中途加入的成员；取消勾选表示退出。更换负责人后，原负责人也可继续协作。
                    </small>
                    <div className="checkbox-list">
                      {overview.data?.members
                        .filter(
                          (member) =>
                            member.id !== owner &&
                            (member.status === 'active' || collabs.includes(member.id)),
                        )
                        .map((member) => (
                          <label key={member.id}>
                            <input
                              type="checkbox"
                              checked={collabs.includes(member.id)}
                              onChange={(event) =>
                                setCollabs((current) =>
                                  event.target.checked
                                    ? [...current, member.id]
                                    : current.filter((id) => id !== member.id),
                                )
                              }
                            />
                            {member.name}
                          </label>
                        ))}
                    </div>
                  </div>
                  {rosterChanges.length > 0 && (
                    <div className="participants-preview">
                      <strong>保存后将记录</strong>
                      {rosterChanges.map((change) => (
                        <span key={change}>{change}</span>
                      ))}
                    </div>
                  )}
                  <Button disabled={busy || !rosterDirty} onClick={() => void saveRoster()}>
                    保存人员调整
                  </Button>
                </div>
              )}
            </section>
            {t.description && <p className="description">{t.description}</p>}
            {t.notes && <p className="description">备注：{t.notes}</p>}
            {t.latest_update && <p className="description">当前进展：{t.latest_update}</p>}
            {!!t.risk_flag && (
              <p className="notice">可能延期{t.risk_note ? `：${t.risk_note}` : '，请留意'}</p>
            )}
            {(t.priority || t.progress !== null || t.start_date) && (
              <p className="description">
                {[
                  t.start_date && `开始 ${dateLabel(t.start_date)}`,
                  t.priority &&
                    `优先级 ${{ low: '低', normal: '普通', high: '高' }[t.priority as 'low' | 'normal' | 'high']}`,
                  t.progress !== null && `进度 ${t.progress}%`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <section className="action-section">
              <h3>快捷处理</h3>
              <div className="detail-actions">
                {t.status !== 'completed' && (
                  <Button
                    disabled={taskActions.busy(t.id)}
                    onClick={() => void command('complete')}
                  >
                    <Check size={16} /> 标记完成
                  </Button>
                )}
                {t.status === 'completed' && (
                  <>
                    <Button
                      disabled={taskActions.busy(t.id)}
                      variant="secondary"
                      onClick={() => void command('reopen')}
                    >
                      重新打开
                    </Button>
                    <Button
                      onClick={() =>
                        onNext({
                          ownerId: t.owner_id,
                          groupId: (() => {
                            const id = overview.data?.members.find(
                              (m) => m.id === t.owner_id,
                            )?.groupId;
                            return overview.data?.groups.find((g) => g.id === id)?.status ===
                              'active'
                              ? id || undefined
                              : undefined;
                          })(),
                          projectName: t.project_name || undefined,
                        })
                      }
                    >
                      <Plus size={16} /> 安排下一任务
                    </Button>
                    {t.events?.at(-1)?.type === 'completed' && (
                      <Button
                        disabled={taskActions.busy(t.id)}
                        variant="ghost"
                        onClick={() => void command('undo_complete')}
                      >
                        撤销本次完成
                      </Button>
                    )}
                  </>
                )}
              </div>
            </section>
            {taskActions.error(t.id) && <p className="form-error">{taskActions.error(t.id)}</p>}
            {error && (
              <div className="form-error">
                {error}{' '}
                {error.includes('更新') && <button onClick={() => task.refetch()}>重新读取</button>}
              </div>
            )}
            <section>
              <div className="section-title">
                <h3>任务信息</h3>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (edit) {
                      if (editDirty && !window.confirm('丢弃未保存的任务信息？')) return;
                      setEdit(false);
                    } else {
                      if (rosterDirty && !window.confirm('丢弃未保存的人员调整？')) return;
                      setRosterEdit(false);
                      setEdit(true);
                    }
                  }}
                >
                  {edit ? '取消编辑' : '编辑'}
                </Button>
              </div>
              {edit && (
                <div className="inline-edit">
                  <Field label="名称">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </Field>
                  <Field label="项目">
                    <input value={project} onChange={(e) => setProject(e.target.value)} />
                  </Field>
                  <Field label="开始日期">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </Field>
                  <Field label="截止日期">
                    <input
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </Field>
                  <Field label="所属小组">
                    <select value={group} onChange={(e) => setGroup(e.target.value)}>
                      <option value="">不指定</option>
                      {overview.data?.groups
                        .filter((g) => g.status === 'active' || g.id === t.group_id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="优先级">
                    <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                      <option value="">不指定</option>
                      <option value="low">低</option>
                      <option value="normal">普通</option>
                      <option value="high">高</option>
                    </select>
                  </Field>
                  <Field label="进度（可选）">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="未知时留空"
                      value={progress}
                      onChange={(e) => setProgress(e.target.value)}
                    />
                  </Field>
                  <Field label="描述">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                  <Field label="备注">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <Button disabled={busy} onClick={save}>
                    保存修改
                  </Button>
                </div>
              )}
            </section>
            <section>
              <h3>事件时间线</h3>
              <div className="timeline">
                {t.events
                  ?.slice()
                  .reverse()
                  .map((e) => (
                    <div key={e.id} className="timeline-item">
                      <span className="timeline-dot" />
                      <div>
                        <strong>{eventNames[e.type] || e.type}</strong>
                        <small>{new Date(e.created_at).toLocaleString('zh-CN')}</small>
                        {e.comment && <p>{e.comment}</p>}
                        {e.type === 'participants_changed' &&
                          participantChanges(e.payload?.before, e.payload?.after).map((change) => (
                            <p key={change}>{change}</p>
                          ))}
                        {e.type === 'submitted' && e.payload?.actualSubmittedAt && (
                          <p>
                            实际提交：
                            {new Date(e.payload.actualSubmittedAt).toLocaleString('zh-CN')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
            <div className="danger-zone">
              <Confirm
                trigger={
                  <Button variant="ghost">
                    <Trash2 size={15} /> 删除误建任务
                  </Button>
                }
                title="删除这项任务？"
                description="任务将从默认列表和统计中移除，事件记录仍保留。"
                onConfirm={remove}
              />
            </div>
          </div>
        )
      )}
    </Drawer>
  );
}
