export type Group = {
  id: string;
  name: string;
  type: string | null;
  leaderId: string | null;
  status: 'active' | 'disabled';
  notes: string | null;
};
export type Member = {
  id: string;
  name: string;
  nickname: string | null;
  position: string;
  avatarId?: string | null;
  groupId: string | null;
  status: 'active' | 'paused' | 'left';
  notes: string | null;
  joinedAt: string;
  leftAt: string | null;
  groupName?: string;
  work_state?: 'idle' | 'working' | 'assigned' | 'review';
  current_tasks?: Task[];
  pending_count?: number;
  history?: any[];
  tasks?: Task[];
};
export type Task = {
  id: string;
  title: string;
  project_name: string | null;
  description: string | null;
  notes: string | null;
  group_id: string | null;
  owner_id: string;
  owner_name?: string;
  owner_avatar_id?: string | null;
  owner?: Member;
  group?: Group;
  group_name?: string;
  status: 'todo' | 'in_progress' | 'pending_review' | 'completed';
  progress: number | null;
  priority: string | null;
  start_date: string | null;
  deadline: string;
  submitted_at: string | null;
  completed_at: string | null;
  version: number;
  latest_update: string | null;
  latest_update_at: string | null;
  risk_flag: number;
  risk_note: string | null;
  risk_reasons?: string[];
  reasons?: string[];
  risk_rank?: number;
  overdue_days?: number;
  is_attention?: boolean;
  collaborators: { id: string; name: string }[];
  events?: any[];
};
export type Overview = {
  today: string;
  timezone: string;
  epoch: string;
  groups: Group[];
  members: Member[];
  counts: {
    active: number;
    unfinished: number;
    working: number;
    assigned: number;
    review: number;
    idle: number;
    pending: number;
    overdue: number;
    dueToday: number;
    attention: number;
  };
  attention: Task[];
  upcoming: Task[];
  weekTasks: Task[];
  nearing: Task[];
};
export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({ error: '服务器响应无法读取' }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), {
      status: response.status,
    });
  return data as T;
}
export const send = <T = any>(url: string, method: string, body: unknown) =>
  api<T>(url, { method, body: JSON.stringify(body) });
export function imageDataUrl(file: File, maxBytes: number): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    return Promise.reject(new Error('仅支持 PNG、JPEG 或 WebP 图片'));
  if (file.size > maxBytes)
    return Promise.reject(new Error(`图片不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
export const statusNames = {
  todo: '未开始',
  in_progress: '进行中',
  pending_review: '待确认',
  completed: '已完成',
} as const;
export const workNames = {
  idle: '空闲',
  working: '工作中',
  assigned: '已安排',
  review: '待确认',
} as const;
export const memberStatusNames = { active: '在职', paused: '暂停', left: '已离组' } as const;
export function taskTiming(task: Task, today: string) {
  if (task.status === 'completed') return '';
  if (task.deadline < today) return task.status === 'pending_review' ? '待确认超期' : '已逾期';
  if (task.deadline === today) return '今日截止';
  return '';
}
export const dateLabel = (date: string) => (date ? date.replaceAll('-', '.') : '');
