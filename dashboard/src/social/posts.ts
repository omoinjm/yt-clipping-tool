import * as instagram from "./instagram";
import * as tiktok from "./tiktok";
import type { Platform } from "./tokens";

export type PostRow = {
  id: number; clip_id: string; platform: Platform; mode: string;
  status: "processing" | "published" | "drafted" | "failed";
  remote_id: string | null; post_id: string | null; url: string | null; caption: string | null; privacy: string | null;
  error: string | null; created_at: string; updated_at: string;
};

export async function clipPosts(db: D1Database, clipId: string): Promise<PostRow[]> {
  const { results } = await db.prepare("SELECT * FROM posts WHERE clip_id = ? ORDER BY id DESC").bind(clipId).all<PostRow>();
  return results;
}

/** Latest post per platform for many clips (clip grid badges). */
export async function latestPosts(db: D1Database): Promise<Map<string, Partial<Record<Platform, PostRow>>>> {
  const { results } = await db
    .prepare("SELECT * FROM posts WHERE id IN (SELECT MAX(id) FROM posts GROUP BY clip_id, platform)")
    .all<PostRow>();
  const out = new Map<string, Partial<Record<Platform, PostRow>>>();
  for (const p of results) out.set(p.clip_id, { ...out.get(p.clip_id), [p.platform]: p });
  return out;
}

export async function insertPost(
  db: D1Database,
  p: Pick<PostRow, "clip_id" | "platform" | "mode" | "caption" | "privacy"> & Partial<Pick<PostRow, "status" | "remote_id" | "error">>,
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO posts (clip_id, platform, mode, status, remote_id, caption, privacy, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(p.clip_id, p.platform, p.mode, p.status ?? "processing", p.remote_id ?? null, p.caption, p.privacy, p.error ?? null)
    .first<{ id: number }>();
  return r!.id;
}

async function updatePost(db: D1Database, id: number, f: Partial<Pick<PostRow, "status" | "post_id" | "url" | "error">>) {
  const cols = Object.keys(f);
  await db
    .prepare(`UPDATE posts SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...Object.values(f), id)
    .run();
}

/** Give up on posts stuck processing this long (TikTok/Instagram finish in minutes). */
const STALE_MS = 2 * 3_600_000;

async function advance(env: Env, p: PostRow): Promise<void> {
  if (!p.remote_id) return;
  try {
    if (p.platform === "tiktok") {
      const s = await tiktok.status(env, p.remote_id);
      if (s.status === "FAILED") return updatePost(env.DB, p.id, { status: "failed", error: `TikTok: ${s.fail_reason ?? "failed"}` });
      if (s.status === "SEND_TO_USER_INBOX") return updatePost(env.DB, p.id, { status: "drafted" });
      if (s.status === "PUBLISH_COMPLETE")
        return updatePost(env.DB, p.id, { status: "published", post_id: s.postId ?? null, url: s.url ?? null });
    } else {
      const r = await instagram.advance(env, p.remote_id);
      if (r && r.ok) return updatePost(env.DB, p.id, { status: "published", post_id: r.postId, url: r.url });
      if (r && !r.ok) return updatePost(env.DB, p.id, { status: "failed", error: r.error });
    }
    if (Date.now() - Date.parse(p.created_at.replace(" ", "T") + "Z") > STALE_MS)
      await updatePost(env.DB, p.id, { status: "failed", error: "Still processing after 2 hours; check the app directly" });
  } catch (err) {
    // Transient API errors: keep polling, but surface the latest one.
    await updatePost(env.DB, p.id, { error: String(err instanceof Error ? err.message : err).slice(0, 500) });
  }
}

/** Poll every post still processing (cron each minute, and on clip page loads). */
export async function advancePending(env: Env, clipId?: string): Promise<void> {
  const q = clipId
    ? env.DB.prepare("SELECT * FROM posts WHERE status = 'processing' AND clip_id = ?").bind(clipId)
    : env.DB.prepare("SELECT * FROM posts WHERE status = 'processing' LIMIT 20");
  const { results } = await q.all<PostRow>();
  for (const p of results) await advance(env, p); // sequential: TikTok allows 30 status calls/min per token
}
