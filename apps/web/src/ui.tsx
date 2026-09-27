import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { cva } from 'class-variance-authority';
import { statusNames, workNames, dateLabel, type Task } from './api';
export function cn(...classes: any[]) {
  return twMerge(clsx(classes));
}
const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      danger: 'btn-danger',
    },
  },
  defaultVariants: { variant: 'primary' },
});
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={cn(buttonVariants({ variant }), className)} {...props}>
      {children}
    </button>
  );
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('card', className)}>{children}</div>;
}
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'teal' | 'amber' | 'green' | 'red';
}) {
  return <span className={cn('pill', `pill-${tone}`)}>{children}</span>;
}
export function StatusPill({ status }: { status: Task['status'] }) {
  return (
    <Pill
      tone={
        { todo: 'neutral', in_progress: 'teal', pending_review: 'amber', completed: 'green' }[
          status
        ] as 'neutral' | 'teal' | 'amber' | 'green'
      }
    >
      {statusNames[status]}
    </Pill>
  );
}
export function WorkPill({ state }: { state: string | null | undefined }) {
  return state ? (
    <Pill
      tone={{ idle: 'green', working: 'teal', assigned: 'neutral', review: 'amber' }[state] as any}
    >
      {workNames[state as keyof typeof workNames]}
    </Pill>
  ) : null;
}
export function Avatar({
  name,
  mediaId,
  large = false,
}: {
  name: string;
  mediaId?: string | null;
  large?: boolean;
}) {
  return (
    <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">
      {mediaId ? <img src={`/api/media/${mediaId}`} alt="" /> : Array.from(name.trim())[0] || '·'}
    </span>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">✦</div>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function Loading() {
  return <div className="loading">正在读取工作台…</div>;
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="errorbox">
      <strong>连接或读取失败</strong>
      <p>{error instanceof Error ? error.message : '请检查主机服务并重试。'}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer">
          <header className="drawer-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {subtitle && <Dialog.Description>{subtitle}</Dialog.Description>}
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="drawer-body">{children}</div>
          {footer && <div className="drawer-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Confirm({
  trigger,
  title,
  description,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="drawer-overlay" />
        <AlertDialog.Content className="confirm">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="confirm-actions">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                确认
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
export function TaskLine({
  task,
  today,
  onClick,
}: {
  task: Task;
  today: string;
  onClick: () => void;
}) {
  const overdue = task.status !== 'completed' && task.deadline < today;
  return (
    <button className="task-line" onClick={onClick}>
      <span className="task-line-main">
        <strong>{task.title}</strong>
        <span>{task.project_name || task.owner_name || '未命名项目'}</span>
      </span>
      <span className="task-line-meta">
        <StatusPill status={task.status} />
        <span className={overdue ? 'text-red' : ''}>{dateLabel(task.deadline)}</span>
      </span>
    </button>
  );
}
