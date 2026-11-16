-- Allow Creative Commons Attribution sources (credit-only reuse; license verified by the job).
-- SQLite can't alter a CHECK constraint, so rebuild the table.
PRAGMA defer_foreign_keys = true;

CREATE TABLE sources_new (
  id            TEXT PRIMARY KEY,
  origin        TEXT NOT NULL,
  owner         TEXT NOT NULL,
  permission    TEXT NOT NULL CHECK (permission IN ('own', 'granted', 'cc_by')),
  proof         TEXT,
  credit        TEXT,
  duration      REAL,
  stage         TEXT NOT NULL DEFAULT 'queued',
  error         TEXT,
  batch_job_id  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sources_new SELECT * FROM sources;
DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
