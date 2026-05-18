CREATE TABLE IF NOT EXISTS users (
  uuid        TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS answers (
  uuid        TEXT PRIMARY KEY,
  answers     TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uuid) REFERENCES users(uuid)
);
