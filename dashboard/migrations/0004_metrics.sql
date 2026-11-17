-- Latest performance numbers per clip and platform (refreshed hourly by the cron, or on demand).
CREATE TABLE metrics (
  clip_id     TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  views       INTEGER,
  likes       INTEGER,
  comments    INTEGER,
  shares      INTEGER,
  saves       INTEGER,
  error       TEXT,                -- last refresh error (numbers keep their previous values)
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (clip_id, platform)
);
