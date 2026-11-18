-- Full long-form video per source (kept in R2 under full/<source>/), published per channel:
-- YouTube automatically (chunked resumable upload driven by the cron), Twitch/Kick by pasting a link.
CREATE TABLE longform (
  source_id        TEXT PRIMARY KEY,
  channel_id       TEXT,                 -- null until assigned; locked once uploaded or linked
  video_key        TEXT NOT NULL,
  thumb_key        TEXT,
  size             INTEGER NOT NULL,
  duration         REAL,
  title            TEXT,
  description      TEXT,
  tags             TEXT NOT NULL DEFAULT '[]',
  yt_status        TEXT CHECK (yt_status IN ('uploading', 'uploaded', 'failed')),
  yt_session       TEXT,                 -- sealed resumable upload URL while uploading
  yt_offset        INTEGER NOT NULL DEFAULT 0,
  yt_video_id      TEXT,
  yt_privacy       TEXT,
  yt_error         TEXT,
  yt_lock_until    INTEGER,              -- epoch ms: one cron tick at a time pushes chunks
  twitch_url       TEXT,
  twitch_video_id  TEXT,
  kick_url         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX longform_channel ON longform(channel_id);

-- Metrics gain Twitch (long-form rows use clip_id = 'full:<source_id>'). Rebuild to widen the CHECK.
CREATE TABLE metrics_new (
  clip_id     TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'twitch')),
  views       INTEGER,
  likes       INTEGER,
  comments    INTEGER,
  shares      INTEGER,
  saves       INTEGER,
  error       TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (clip_id, platform)
);
INSERT INTO metrics_new SELECT clip_id, platform, views, likes, comments, shares, saves, error, fetched_at FROM metrics;
DROP TABLE metrics;
ALTER TABLE metrics_new RENAME TO metrics;

-- Each channel's own Twitch / Kick pages (where to upload long-form by hand).
ALTER TABLE channels ADD COLUMN twitch_url TEXT;
ALTER TABLE channels ADD COLUMN kick_url TEXT;
