import { z } from 'zod';
export const businessDate = z.iso.date();
const taskBase = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().uuid(),
  deadline: businessDate,
  projectName: z.string().trim().max(100).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  collaboratorIds: z.array(z.string().uuid()).max(30).optional(),
  startDate: businessDate.nullable().optional(),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).nullable().optional(),
});
export const taskInput = taskBase
  .extend({ collaboratorIds: z.array(z.string().uuid()).max(30).default([]) })
  .refine((x) => !x.startDate || x.startDate <= x.deadline, {
    message: '开始日不能晚于截止日',
    path: ['startDate'],
  });
export const taskEdit = taskBase.partial().extend({ version: z.number().int().positive() });
export const transitionInput = z.object({
  action: z.enum(['start', 'submit', 'approve', 'reject', 'undo_approve']),
  version: z.number().int().positive(),
  comment: z.string().max(5000).nullable().optional(),
  submittedAt: z.iso.datetime({ offset: true }).optional(),
});
export const taskCommandInput = z.object({
  action: z.enum([
    'start',
    'complete',
    'undo_complete',
    'mark_pending',
    'resume',
    'reopen',
    'reset_to_todo',
  ]),
  version: z.number().int().positive(),
  comment: z.string().trim().max(5000).nullable().optional(),
});
export const taskUpdateInput = z.object({
  version: z.number().int().positive(),
  latestUpdate: z.string().trim().max(280).nullable(),
});
export const taskRiskInput = z.object({
  version: z.number().int().positive(),
  riskFlag: z.boolean(),
  riskNote: z.string().trim().max(200).nullable().optional(),
});
