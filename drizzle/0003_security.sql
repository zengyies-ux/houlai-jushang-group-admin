DROP TABLE IF EXISTS smoke_records;
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
