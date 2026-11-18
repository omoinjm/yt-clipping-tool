-- Customizable clip headers ("hook card"): style library, channel default + per-clip override,
-- and CPU re-renders that apply a new style to an already-clipped video.
CREATE TABLE header_styles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  note        TEXT,
  style       TEXT NOT NULL,              -- HeaderStyle JSON (remotion/src/header.ts)
  builtin     INTEGER NOT NULL DEFAULT 0, -- presets: copy to customise, can't be edited
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Built-in presets (generated from remotion/src/header-presets.ts).
INSERT INTO header_styles (id, name, note, style, builtin) VALUES
  ('pop-card', 'Pop card', 'White card that pops in for the first seconds (the original look, cleaned up).', '{"font":"Montserrat","weight":900,"size":66,"color":"#111111","uppercase":false,"letterSpacing":0,"lineHeight":1.15,"strokeColor":"#000000","strokeWidth":0,"shadow":true,"highlightColor":"#E11D48","highlightBg":"","box":"rect","bg":"#FFFFFF","bgOpacity":1,"radius":24,"paddingX":40,"paddingY":24,"borderColor":"#000000","borderWidth":0,"rotate":-2,"maxWidth":900,"position":"top","offsetY":250,"animation":"pop","duration":3}', 1),
  ('podcast-bar', 'Podcast title bar', 'Full-width bar that stays for the whole clip, like podcast clip channels.', '{"font":"Montserrat","weight":900,"size":58,"color":"#FFFFFF","uppercase":true,"letterSpacing":0,"lineHeight":1.15,"strokeColor":"#000000","strokeWidth":0,"shadow":false,"highlightColor":"#FFD84D","highlightBg":"","box":"banner","bg":"#000000","bgOpacity":0.92,"radius":22,"paddingX":48,"paddingY":30,"borderColor":"#000000","borderWidth":0,"rotate":0,"maxWidth":900,"position":"top","offsetY":200,"animation":"fade","duration":0}', 1),
  ('bold-outline', 'Bold outline', 'No box: big white letters with a thick black outline.', '{"font":"Anton","weight":400,"size":92,"color":"#FFFFFF","uppercase":true,"letterSpacing":1,"lineHeight":1.05,"strokeColor":"#000000","strokeWidth":16,"shadow":true,"highlightColor":"#FFD84D","highlightBg":"","box":"none","bg":"#FFFFFF","bgOpacity":1,"radius":22,"paddingX":40,"paddingY":24,"borderColor":"#000000","borderWidth":0,"rotate":0,"maxWidth":980,"position":"top","offsetY":230,"animation":"pop","duration":3.5}', 1),
  ('keyword-highlight', 'Black box + keyword', 'Black box, white text, key words in yellow (wrap them in *asterisks*).', '{"font":"Montserrat","weight":900,"size":62,"color":"#FFFFFF","uppercase":false,"letterSpacing":0,"lineHeight":1.15,"strokeColor":"#000000","strokeWidth":0,"shadow":true,"highlightColor":"#111111","highlightBg":"#FFD84D","box":"rect","bg":"#0B0B0B","bgOpacity":1,"radius":14,"paddingX":36,"paddingY":22,"borderColor":"#000000","borderWidth":0,"rotate":0,"maxWidth":900,"position":"top","offsetY":250,"animation":"slide","duration":3.5}', 1),
  ('sticker', 'Tilted sticker', 'Bright sticker with a dark border, tilted for energy.', '{"font":"Bangers","weight":400,"size":84,"color":"#111111","uppercase":false,"letterSpacing":2,"lineHeight":1.15,"strokeColor":"#000000","strokeWidth":0,"shadow":true,"highlightColor":"#E11D48","highlightBg":"","box":"rect","bg":"#FFD84D","bgOpacity":1,"radius":18,"paddingX":38,"paddingY":18,"borderColor":"#111111","borderWidth":7,"rotate":-4,"maxWidth":900,"position":"top","offsetY":250,"animation":"pop","duration":3}', 1),
  ('minimal-pill', 'Minimal pill', 'Small, semi-transparent pill. Quiet, stays the whole clip.', '{"font":"Inter","weight":800,"size":44,"color":"#FFFFFF","uppercase":false,"letterSpacing":0,"lineHeight":1.15,"strokeColor":"#000000","strokeWidth":0,"shadow":false,"highlightColor":"#7DD3FC","highlightBg":"","box":"pill","bg":"#000000","bgOpacity":0.55,"radius":22,"paddingX":34,"paddingY":16,"borderColor":"#000000","borderWidth":0,"rotate":0,"maxWidth":820,"position":"top","offsetY":210,"animation":"fade","duration":0}', 1);
INSERT INTO settings (key, value) VALUES ('header_style_default', 'pop-card')
  ON CONFLICT(key) DO NOTHING;

ALTER TABLE channels ADD COLUMN header_style_id TEXT;    -- channel default (null = global default)
ALTER TABLE clips ADD COLUMN header_style_id TEXT;       -- per-clip override (null = channel/global)
ALTER TABLE clips ADD COLUMN render_key TEXT;            -- R2 prefix of saved re-render inputs
ALTER TABLE clips ADD COLUMN rendered_style TEXT;        -- hash of the style+text the current video has

CREATE TABLE render_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id       TEXT NOT NULL,
  batch_job_id  TEXT,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  video_key     TEXT NOT NULL,                -- where the new video will land
  thumb_key     TEXT NOT NULL,
  style_hash    TEXT NOT NULL,
  hook          TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX render_jobs_status ON render_jobs(status);
CREATE INDEX render_jobs_clip ON render_jobs(clip_id, id);
