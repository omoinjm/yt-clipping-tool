/** Channels: niche brands, each with its own connected YouTube / TikTok / Instagram accounts. */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ClipRow } from "./db";

export type ChannelRow = {
  id: string; name: string; niche: string | null; hashtags: string; created_at: string; clip_count?: number;
  twitch_url: string | null; kick_url: string | null; // the channel's own pages, for uploading long-form by hand
  header_style_id: string | null; // default header style for this channel's clips
};

export const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export async function listChannels(db: D1Database): Promise<ChannelRow[]> {
  const { results } = await db
    .prepare("SELECT ch.*, (SELECT COUNT(*) FROM clips c WHERE c.channel_id = ch.id) AS clip_count FROM channels ch ORDER BY ch.name")
    .all<ChannelRow>();
  return results;
}

export function getChannel(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<ChannelRow>();
}

export function normalizeHashtags(raw: string): string {
  const seen = new Set<string>();
  return raw
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#*/, "").normalize("NFKD").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 10)
    .map((t) => `#${t}`)
    .join(" ");
}

/** Only keep a plausible channel page URL on that site. */
export function cleanPageUrl(raw: string, host: "twitch.tv" | "kick.com"): string | null {
  const u = raw.trim();
  return u && new RegExp(`^https://(www\\.)?${host.replace(".", "\\.")}/[\\w-]+/?$`, "i").test(u) ? u : null;
}

export async function saveChannel(
  db: D1Database,
  ch: { id: string; name: string; niche: string; hashtags: string; twitch_url?: string; kick_url?: string; header_style_id?: string },
  isNew: boolean,
) {
  const tw = cleanPageUrl(ch.twitch_url ?? "", "twitch.tv");
  const kk = cleanPageUrl(ch.kick_url ?? "", "kick.com");
  const hs = ch.header_style_id || null;
  if (isNew)
    await db.prepare("INSERT INTO channels (id, name, niche, hashtags, twitch_url, kick_url, header_style_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(ch.id, ch.name, ch.niche || null, normalizeHashtags(ch.hashtags), tw, kk, hs).run();
  else
    await db.prepare("UPDATE channels SET name = ?, niche = ?, hashtags = ?, twitch_url = ?, kick_url = ?, header_style_id = ? WHERE id = ?")
      .bind(ch.name, ch.niche || null, normalizeHashtags(ch.hashtags), tw, kk, hs, ch.id).run();
}

/** Delete a channel and its logins; its clips go back to unassigned (only allowed with nothing published). */
export async function deleteChannel(db: D1Database, id: string): Promise<string | null> {
  const live = await db.prepare(
    `SELECT COUNT(*) AS n FROM clips WHERE channel_id = ? AND (youtube_id IS NOT NULL OR id IN
       (SELECT clip_id FROM posts WHERE status IN ('published', 'drafted', 'processing')))`,
  ).bind(id).first<{ n: number }>();
  if (live && live.n > 0) return `It has ${live.n} published clip(s); those stay tied to it.`;
  const liveLong = await db.prepare(
    `SELECT COUNT(*) AS n FROM longform WHERE channel_id = ? AND (yt_status IN ('uploading', 'uploaded') OR twitch_url IS NOT NULL OR kick_url IS NOT NULL)`,
  ).bind(id).first<{ n: number }>();
  if (liveLong && liveLong.n > 0) return `It has ${liveLong.n} published full video(s); those stay tied to it.`;
  await db.batch([
    db.prepare("UPDATE clips SET channel_id = NULL WHERE channel_id = ?").bind(id),
    db.prepare("UPDATE longform SET channel_id = NULL WHERE channel_id = ?").bind(id),
    db.prepare("DELETE FROM oauth_tokens WHERE channel_id = ?").bind(id),
    db.prepare("DELETE FROM channels WHERE id = ?").bind(id),
  ]);
  return null;
}

/**
 * A clip's channel is locked once it has gone out anywhere (uploaded, posted, drafted or posting),
 * so posts and stats stay with the account they were made on.
 */
export async function clipLocked(db: D1Database, clip: ClipRow): Promise<boolean> {
  if (clip.youtube_id) return true;
  const r = await db.prepare("SELECT 1 AS x FROM posts WHERE clip_id = ? AND status IN ('published', 'drafted', 'processing') LIMIT 1")
    .bind(clip.id).first();
  return !!r;
}

export async function assignClip(db: D1Database, clipId: string, channelId: string | null) {
  await db.prepare("UPDATE clips SET channel_id = ?, updated_at = datetime('now') WHERE id = ?").bind(channelId, clipId).run();
}

// ── current channel (header switcher), remembered in a cookie: "" = all, "none" = unassigned, else a channel id
export const SCOPE_COOKIE = "channel";
export function currentScope(c: Context): string {
  const v = getCookie(c, SCOPE_COOKIE) ?? "";
  return v === "none" || CHANNEL_ID_RE.test(v) ? v : "";
}

export function inScope(scope: string, clip: Pick<ClipRow, "channel_id">): boolean {
  return scope === "" || (scope === "none" ? !clip.channel_id : clip.channel_id === scope);
}
