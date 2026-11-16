CREATE TABLE sources (
  id            TEXT PRIMARY KEY,
  origin        TEXT NOT NULL,
  owner         TEXT NOT NULL,
  permission    TEXT NOT NULL CHECK (permission IN ('own', 'granted')),
  proof         TEXT,
  credit        TEXT,
  duration      REAL,
  stage         TEXT NOT NULL DEFAULT 'queued',
  error         TEXT,
  batch_job_id  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clips (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  start        REAL NOT NULL,
  end          REAL NOT NULL,
  score        REAL,
  hook         TEXT,
  title        TEXT,
  description  TEXT,
  tags         TEXT NOT NULL DEFAULT '[]',
  reason       TEXT,
  stage        TEXT NOT NULL DEFAULT 'selected',
  review       TEXT NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'approved', 'rejected')),
  layout       TEXT,
  duration     REAL,
  video_key    TEXT,
  thumb_key    TEXT,
  output_path  TEXT,
  youtube_id   TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX clips_source ON clips(source_id);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT,
  clip_id    TEXT,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX events_source ON events(source_id, id);
