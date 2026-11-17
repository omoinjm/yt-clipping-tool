/** Per-clip performance numbers from each platform, cached in D1 (`metrics`). */
import * as instagram from "./instagram";
import * as tiktok from "./tiktok";
import { videoStats as youtubeStats, type Stats } from "../youtube";

export type MetricPlatform = "youtube" | "tiktok" | "instagram";
export type MetricRow = Stats & { clip_id: string; platform: MetricPlatform; error: string | null; fetched_at: string };
export type ClipMetrics = Partial<Record<MetricPlatform, MetricRow>>;

const COLS = ["views", "likes", "comments", "shares", "saves"] as const;

export async function allMetrics(db: D1Database, clipId?: string): Promise<Map<string, ClipMetrics>> {
  const q = clipId ? db.prepare("SELECT * FROM metrics WHERE clip_id = ?").bind(clipId) : db.prepare("SELECT * FROM metrics");
  const { results } = await q.all<MetricRow>();
  const out = new Map<string, ClipMetrics>();
  for (const r of results) out.set(r.clip_id, { ...out.get(r.clip_id), [r.platform]: r });
  return out;
}

/** Sum of one stat across platforms (undefined when no platform reports it). */
export function total(m: ClipMetrics | undefined, k: (typeof COLS)[number]): number | undefined {
  const vals = Object.values(m ?? {}).map((r) => r?.[k]).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
}

const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (n?: number | null) => (n == null ? "—" : compactFmt.format(n));

function saveStmt(db: D1Database, clipId: string, platform: MetricPlatform, s: Stats) {
  return db.prepare(
    `INSERT INTO metrics (clip_id, platform, views, likes, comments, shares, saves, error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
     ON CONFLICT(clip_id, platform) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments,
       shares = excluded.shares, saves = excluded.saves, error = NULL, fetched_at = excluded.fetched_at`,
  ).bind(clipId, platform, ...COLS.map((k) => s[k] ?? null));
}

/** Record an error without wiping the last good numbers. */
function errorStmt(db: D1Database, clipId: string, platform: MetricPlatform, err: unknown) {
  const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
  return db.prepare(
    `INSERT INTO metrics (clip_id, platform, error, fetched_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(clip_id, platform) DO UPDATE SET error = excluded.error, fetched_at = excluded.fetched_at`,
  ).bind(clipId, platform, msg);
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Fetch fresh numbers for every published clip (or one clip). Returns how many rows were updated and any errors. */
export async function refreshMetrics(env: Env, clipId?: string): Promise<{ updated: number; errors: string[] }> {
  const db = env.DB;
  const byClip = clipId ? " AND clip_id = ?" : "";
  const yt = await (clipId
    ? db.prepare("SELECT id AS clip_id, youtube_id AS post_id FROM clips WHERE youtube_id IS NOT NULL AND id = ?").bind(clipId)
    : db.prepare("SELECT id AS clip_id, youtube_id AS post_id FROM clips WHERE youtube_id IS NOT NULL")
  ).all<{ clip_id: string; post_id: string }>();
  const latestSql = `SELECT clip_id, platform, post_id FROM posts WHERE id IN
    (SELECT MAX(id) FROM posts WHERE status = 'published' AND post_id IS NOT NULL GROUP BY clip_id, platform)${byClip}`;
  const social = await (clipId ? db.prepare(latestSql).bind(clipId) : db.prepare(latestSql))
    .all<{ clip_id: string; platform: "tiktok" | "instagram"; post_id: string }>();

  const stmts: D1PreparedStatement[] = [];
  const errors: string[] = [];
  const fail = (platform: MetricPlatform, rows: { clip_id: string }[], err: unknown) => {
    errors.push(`${platform}: ${err instanceof Error ? err.message : String(err)}`);
    for (const r of rows) stmts.push(errorStmt(db, r.clip_id, platform, err));
  };

  // YouTube: 50 ids per call.
  for (const rows of chunk(yt.results, 50)) {
    try {
      const stats = await youtubeStats(env, rows.map((r) => r.post_id));
      for (const r of rows) {
        const s = stats.get(r.post_id);
        stmts.push(s ? saveStmt(db, r.clip_id, "youtube", s) : errorStmt(db, r.clip_id, "youtube", "Video not found (deleted?)"));
      }
    } catch (err) {
      fail("youtube", rows, err);
    }
  }
  // TikTok: 20 ids per call.
  for (const rows of chunk(social.results.filter((r) => r.platform === "tiktok"), 20)) {
    try {
      const stats = await tiktok.videoStats(env, rows.map((r) => r.post_id));
      for (const r of rows) {
        const s = stats.get(r.post_id);
        stmts.push(s ? saveStmt(db, r.clip_id, "tiktok", s) : errorStmt(db, r.clip_id, "tiktok", "Video not found or not public"));
      }
    } catch (err) {
      fail("tiktok", rows, err);
    }
  }
  // Instagram: one call per Reel.
  for (const r of social.results.filter((x) => x.platform === "instagram")) {
    try {
      stmts.push(saveStmt(db, r.clip_id, "instagram", await instagram.mediaStats(env, r.post_id)));
    } catch (err) {
      fail("instagram", [r], err);
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { updated: stmts.length, errors: [...new Set(errors)] };
}
