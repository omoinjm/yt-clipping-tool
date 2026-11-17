export type SourceRow = {
  id: string; origin: string; owner: string; permission: string; proof: string | null; credit: string | null;
  duration: number | null; stage: string; error: string | null; batch_job_id: string | null;
  created_at: string; updated_at: string; clip_count?: number; posted_count?: number;
};

export type ClipRow = {
  id: string; source_id: string; start: number; end: number; score: number | null; hook: string | null;
  title: string | null; description: string | null; tags: string; reason: string | null; stage: string;
  review: "pending" | "approved" | "rejected"; layout: string | null; duration: number | null;
  video_key: string | null; thumb_key: string | null; output_path: string | null; youtube_id: string | null;
  error: string | null; created_at: string; updated_at: string;
  captions: string; // JSON {tiktok?, instagram?}: user-written captions
  channel_id: string | null; // which channel it belongs to; null until assigned after clipping
};

type Value = string | number | null;

const SOURCE_COLS = ["origin", "owner", "permission", "proof", "credit", "duration", "stage", "error", "batch_job_id"];
const CLIP_UPDATE_COLS = [
  "stage", "review", "layout", "duration", "video_key", "thumb_key", "output_path", "youtube_id", "error",
  "title", "description", "tags", "hook", "captions",
];

/** Keep only whitelisted columns; serialize arrays (tags) to JSON. */
export function pick(body: Record<string, unknown>, cols: string[]): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const col of cols) {
    if (!(col in body)) continue;
    const v = body[col];
    out[col] = Array.isArray(v) ? JSON.stringify(v) : v === undefined ? null : (v as Value);
  }
  return out;
}

export async function listSources(db: D1Database): Promise<SourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM clips c WHERE c.source_id = s.id) AS clip_count,
         (SELECT COUNT(*) FROM clips c WHERE c.source_id = s.id AND (c.youtube_id IS NOT NULL OR EXISTS
           (SELECT 1 FROM posts p WHERE p.clip_id = c.id AND p.status IN ('published', 'drafted')))) AS posted_count
       FROM sources s ORDER BY s.updated_at DESC LIMIT 200`,
    )
    .all<SourceRow>();
  return results;
}

export function getSource(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
}

export async function upsertSource(db: D1Database, id: string, body: Record<string, unknown>) {
  const row = pick(body, SOURCE_COLS);
  const cols = Object.keys(row);
  if (!("origin" in row && "owner" in row && "permission" in row)) throw new Error("origin, owner, permission required");
  const updates = cols.map((c) => `${c} = excluded.${c}`).concat("updated_at = datetime('now')").join(", ");
  const stmts = [
    db.prepare(
      `INSERT INTO sources (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})
       ON CONFLICT(id) DO UPDATE SET ${updates}`,
    ).bind(id, ...Object.values(row)),
  ];
  // The job reports "ingested" through this upsert; log it like any stage change (the ETA uses the timeline).
  if (row.stage && row.stage !== "queued")
    stmts.push(db.prepare("INSERT INTO events (source_id, message) VALUES (?, ?)").bind(id, `stage → ${row.stage}`));
  await db.batch(stmts);
}

export async function setSourceStage(db: D1Database, id: string, body: Record<string, unknown>) {
  const row = pick(body, SOURCE_COLS);
  if (!row.stage) throw new Error("stage required");
  const sets = Object.keys(row).map((c) => `${c} = ?`).concat("updated_at = datetime('now')").join(", ");
  await db.batch([
    db.prepare(`UPDATE sources SET ${sets} WHERE id = ?`).bind(...Object.values(row), id),
    db.prepare("INSERT INTO events (source_id, message) VALUES (?, ?)")
      .bind(id, `stage → ${row.stage}${row.error ? `: ${String(row.error).slice(0, 300)}` : ""}`),
  ]);
}

export async function replaceClips(db: D1Database, sourceId: string, clips: Record<string, unknown>[]) {
  // Keep clips already published anywhere (YouTube, or a TikTok/Instagram post that didn't fail).
  const stmts = [
    db.prepare(
      `DELETE FROM clips WHERE source_id = ? AND youtube_id IS NULL
       AND id NOT IN (SELECT clip_id FROM posts WHERE status != 'failed')`,
    ).bind(sourceId),
  ];
  for (const c of clips) {
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO clips (id, source_id, start, end, score, hook, title, description, tags, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        String(c.id), sourceId, Number(c.start), Number(c.end), (c.score as number) ?? null, (c.hook as string) ?? null,
        (c.title as string) ?? null, (c.description as string) ?? null, JSON.stringify(c.tags ?? []),
        (c.reason as string) ?? null,
      ),
    );
  }
  await db.batch(stmts);
}

export async function listClips(db: D1Database, f: { source?: string; stage?: string; review?: string }) {
  const where: string[] = [];
  const args: Value[] = [];
  if (f.source) (where.push("source_id = ?"), args.push(f.source));
  if (f.stage) (where.push("stage = ?"), args.push(f.stage));
  if (f.review) (where.push("review = ?"), args.push(f.review));
  const sql = `SELECT * FROM clips ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY created_at DESC, score DESC LIMIT 500`;
  const { results } = await db.prepare(sql).bind(...args).all<ClipRow>();
  return results;
}

export function getClip(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM clips WHERE id = ?").bind(id).first<ClipRow>();
}

export async function updateClip(db: D1Database, id: string, body: Record<string, unknown>) {
  const row = pick(body, CLIP_UPDATE_COLS);
  if (Object.keys(row).length === 0) return;
  const sets = Object.keys(row).map((c) => `${c} = ?`).concat("updated_at = datetime('now')").join(", ");
  await db.prepare(`UPDATE clips SET ${sets} WHERE id = ?`).bind(...Object.values(row), id).run();
}

export async function sourceEvents(db: D1Database, sourceId: string) {
  const { results } = await db
    .prepare("SELECT message, created_at FROM events WHERE source_id = ? ORDER BY id DESC LIMIT 30")
    .bind(sourceId)
    .all<{ message: string; created_at: string }>();
  return results;
}
