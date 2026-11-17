-- Public upload link: anyone with the link can upload a video for review. Nothing is processed until
-- an operator accepts it (which creates a "granted" source and queues the GPU job).
CREATE TABLE submissions (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'uploading'
                 CHECK (status IN ('uploading', 'received', 'accepted', 'rejected')),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  title          TEXT,
  notes          TEXT,
  credit         TEXT,
  filename       TEXT NOT NULL,
  size           INTEGER NOT NULL,
  content_type   TEXT,
  r2_key         TEXT NOT NULL,
  upload_id      TEXT,                 -- R2 multipart upload id while uploading
  upload_secret  TEXT,                 -- per-upload secret the browser must send with each part
  ip_hash        TEXT,                 -- salted hash, for rate limiting only
  source_id      TEXT,                 -- set when accepted
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX submissions_status ON submissions(status, created_at);
CREATE INDEX submissions_ip ON submissions(ip_hash, created_at);

-- Small key/value settings (the upload link token lives here; NULL/absent = link disabled).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
