import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const groupsTable = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type'),
  leaderId: text('leader_id'),
  status: text('status').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const membersTable = sqliteTable('members', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname'),
  position: text('position').notNull(),
  avatarId: text('avatar_id'),
  groupId: text('group_id'),
  status: text('status').notNull(),
  notes: text('notes'),
  joinedAt: text('joined_at').notNull(),
  leftAt: text('left_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const tasksTable = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  projectName: text('project_name'),
  description: text('description'),
  notes: text('notes'),
  groupId: text('group_id'),
  ownerId: text('owner_id').notNull(),
  status: text('status').notNull(),
  progress: integer('progress'),
  priority: text('priority'),
  startDate: text('start_date'),
  deadline: text('deadline').notNull(),
  submittedAt: text('submitted_at'),
  completedAt: text('completed_at'),
  latestUpdate: text('latest_update'),
  latestUpdateAt: text('latest_update_at'),
  riskFlag: integer('risk_flag').notNull().default(0),
  riskNote: text('risk_note'),
  version: integer('version').notNull(),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const collaboratorsTable = sqliteTable(
  'task_collaborators',
  {
    taskId: text('task_id').notNull(),
    memberId: text('member_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.memberId] })],
);
