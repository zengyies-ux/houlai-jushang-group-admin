ALTER TABLE tasks ADD COLUMN latest_update TEXT;
ALTER TABLE tasks ADD COLUMN latest_update_at TEXT;
ALTER TABLE tasks ADD COLUMN risk_flag INTEGER NOT NULL DEFAULT 0 CHECK(risk_flag IN (0, 1));
ALTER TABLE tasks ADD COLUMN risk_note TEXT;
