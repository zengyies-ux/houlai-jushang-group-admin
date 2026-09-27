CREATE TABLE groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, leader_id TEXT REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE members (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, position TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','left')),
  notes TEXT, joined_at TEXT NOT NULL, left_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE member_group_history (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT, group_name_snapshot TEXT,
  started_at TEXT NOT NULL, ended_at TEXT
);
CREATE UNIQUE INDEX member_one_open_group_history ON member_group_history(member_id) WHERE ended_at IS NULL;
CREATE INDEX members_group_idx ON members(group_id, status);
CREATE INDEX member_history_idx ON member_group_history(member_id, started_at);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_name TEXT, description TEXT, notes TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT, owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','pending_review','completed')),
  progress INTEGER CHECK(progress IS NULL OR (progress BETWEEN 0 AND 100)), priority TEXT,
  start_date TEXT, deadline TEXT NOT NULL, submitted_at TEXT, completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE task_collaborators (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  PRIMARY KEY(task_id, member_id)
);
CREATE TABLE task_events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  type TEXT NOT NULL, from_status TEXT, to_status TEXT, comment TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('timezone','Asia/Shanghai');
CREATE INDEX tasks_status_deadline_idx ON tasks(status, deadline) WHERE deleted_at IS NULL;
CREATE INDEX tasks_owner_idx ON tasks(owner_id, status) WHERE deleted_at IS NULL;
CREATE INDEX tasks_group_idx ON tasks(group_id, status) WHERE deleted_at IS NULL;
CREATE INDEX collaborators_member_idx ON task_collaborators(member_id, task_id);
CREATE INDEX events_task_idx ON task_events(task_id, created_at);
