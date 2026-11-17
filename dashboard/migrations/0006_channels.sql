-- Channels: niche brands, each with its own YouTube / TikTok / Instagram accounts.
-- Clips start unassigned; once assigned (after clipping) they show and post only under that channel.
CREATE TABLE channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  niche       TEXT,
  hashtags    TEXT NOT NULL DEFAULT '',   -- extra hashtags auto captions add for this channel
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO channels (id, name) VALUES ('shukela-clips', 'Shukela Clips');

-- Logins are now per channel + platform (was one per platform). Existing ones move to Shukela Clips.
CREATE TABLE oauth_tokens_new (
  channel_id          TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube')),
  account_id          TEXT NOT NULL,
  account_name        TEXT,
  access_token        TEXT NOT NULL,
  access_expires_at   INTEGER NOT NULL,
  refresh_token       TEXT,
  refresh_expires_at  INTEGER,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, platform)
);
INSERT INTO oauth_tokens_new (channel_id, platform, account_id, account_name, access_token, access_expires_at, refresh_token, refresh_expires_at, updated_at)
  SELECT 'shukela-clips', platform, account_id, account_name, access_token, access_expires_at, refresh_token, refresh_expires_at, updated_at FROM oauth_tokens;
DROP TABLE oauth_tokens;
ALTER TABLE oauth_tokens_new RENAME TO oauth_tokens;

ALTER TABLE clips ADD COLUMN channel_id TEXT;
CREATE INDEX clips_channel ON clips(channel_id);
-- Clips already published somewhere belong to the channel they went out on.
UPDATE clips SET channel_id = 'shukela-clips'
  WHERE youtube_id IS NOT NULL OR id IN (SELECT clip_id FROM posts WHERE status IN ('published', 'drafted', 'processing'));

-- Which channel's account each post went out on (polling and stats use that account's login).
ALTER TABLE posts ADD COLUMN channel_id TEXT;
UPDATE posts SET channel_id = 'shukela-clips';
