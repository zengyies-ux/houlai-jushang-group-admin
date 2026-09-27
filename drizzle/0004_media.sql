CREATE TABLE media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('avatar','background')),
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE members ADD COLUMN avatar_id TEXT REFERENCES media(id) ON DELETE SET NULL;
