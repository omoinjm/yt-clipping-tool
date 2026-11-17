-- TikTok + Instagram publishing.
-- Per-platform caption overrides on each clip: {"tiktok": "...", "instagram": "..."}; missing = auto caption.
ALTER TABLE clips ADD COLUMN captions TEXT NOT NULL DEFAULT '{}';

-- One row per publish attempt. No FK to clips: re-selection rewrites clip rows with INSERT OR REPLACE.
CREATE TABLE posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id     TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram')),
  mode        TEXT NOT NULL,                 -- tiktok: direct | draft · instagram: reel
  status      TEXT NOT NULL DEFAULT 'processing'
              CHECK (status IN ('processing', 'published', 'drafted', 'failed')),
  remote_id   TEXT,                          -- TikTok publish_id / Instagram container id
  post_id     TEXT,                          -- the published post / media id
  url         TEXT,
  caption     TEXT,
  privacy     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX posts_clip ON posts(clip_id, id);
CREATE INDEX posts_status ON posts(status);

-- Connected accounts (YouTube too: its upload stays on clips.youtube_id). Tokens are AES-GCM encrypted with the TOKEN_ENC_KEY Worker secret.
CREATE TABLE oauth_tokens (
  platform            TEXT PRIMARY KEY CHECK (platform IN ('tiktok', 'instagram', 'youtube')),
  account_id          TEXT NOT NULL,
  account_name        TEXT,
  access_token        TEXT NOT NULL,
  access_expires_at   INTEGER NOT NULL,      -- epoch ms
  refresh_token       TEXT,
  refresh_expires_at  INTEGER,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
