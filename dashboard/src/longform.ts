/**
 * Full long-form videos: one per processed source, kept in R2 under full/<source>/.
 * YouTube uploads are resumable and chunked: starting one opens a session; the every-minute cron then
 * pushes up to CHUNKS_PER_TICK × CHUNK bytes per tick from R2 range reads (no browser request held open).
 * Twitch and Kick have no upload API, so those are links the user pastes after uploading by hand.
 */
import { open, seal } from "./social/tokens";
import { accessToken, buildDescription } from "./youtube";

const CHUNK = 128 * 1024 * 1024; // multiple of 256 KiB, as YouTube requires for non-final chunks
const CHUNKS_PER_TICK = 3;

export type LongformRow = {
  source_id: string; channel_id: string | null; video_key: string; thumb_key: string | null;
  size: number; duration: number | null; title: string | null; description: string | null; tags: string;
  yt_status: "uploading" | "uploaded" | "failed" | null; yt_session: string | null; yt_offset: number;
  yt_video_id: string | null; yt_privacy: string | null; yt_error: string | null; yt_lock_until: number | null;
  twitch_url: string | null; twitch_video_id: string | null; kick_url: string | null;
  created_at: string; updated_at: string;
};

export const metricKey = (sourceId: string) => `full:${sourceId}`;

export async function listLongform(db: D1Database): Promise<LongformRow[]> {
  const { results } = await db.prepare("SELECT * FROM longform ORDER BY created_at DESC LIMIT 500").all<LongformRow>();
  return results;
}

export function getLongform(db: D1Database, sourceId: string) {
  return db.prepare("SELECT * FROM longform WHERE source_id = ?").bind(sourceId).first<LongformRow>();
}

/** Called by the GPU job after ingest (and by `clipper publish-full`). Keeps user edits to title/description/tags. */
export async function upsertLongform(
  db: D1Database,
  sourceId: string,
  f: { video_key: string; thumb_key?: string | null; size: number; duration?: number | null; title?: string | null; description?: string | null; tags?: string[] },
) {
  await db.prepare(
    `INSERT INTO longform (source_id, video_key, thumb_key, size, duration, title, description, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET video_key = excluded.video_key, thumb_key = excluded.thumb_key,
       size = excluded.size, duration = excluded.duration,
       title = COALESCE(longform.title, excluded.title), description = COALESCE(longform.description, excluded.description),
       updated_at = datetime('now')`,
  ).bind(
    sourceId, f.video_key, f.thumb_key ?? null, f.size, f.duration ?? null, f.title ?? null, f.description ?? null,
    JSON.stringify((f.tags ?? []).slice(0, 15)),
  ).run();
}

export async function updateLongform(db: D1Database, sourceId: string, f: Partial<LongformRow>) {
  const cols = Object.keys(f);
  if (!cols.length) return;
  await db.prepare(`UPDATE longform SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE source_id = ?`)
    .bind(...Object.values(f), sourceId).run();
}

/** Channel is locked once the video went out anywhere (uploading/uploaded to YouTube, or linked on Twitch/Kick). */
export const longformLocked = (lf: LongformRow) =>
  lf.yt_status === "uploading" || lf.yt_status === "uploaded" || !!lf.twitch_url || !!lf.kick_url;

// ── YouTube (resumable, chunked by the cron)

export async function startYouTubeUpload(env: Env, lf: LongformRow, privacy: "private" | "unlisted" | "public", credit: string | null) {
  if (!lf.channel_id) throw new Error("Assign the video to a channel first");
  const head = await env.CLIPS.head(lf.video_key);
  if (!head) throw new Error(`missing R2 object ${lf.video_key}`);
  const token = await accessToken(env, lf.channel_id);
  const tags: string[] = JSON.parse(lf.tags || "[]");
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(head.size),
    },
    body: JSON.stringify({
      snippet: {
        title: (lf.title || lf.source_id).slice(0, 100),
        // Long-form: no #Shorts tag; credit line kept like the clips.
        description: buildDescription(lf.description ?? "", credit, tags).replace(/^#Shorts ?/m, "").trim().slice(0, 5000),
        tags: tags.slice(0, 15),
        categoryId: env.YT_CATEGORY_ID || "22",
      },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    }),
  });
  const session = init.headers.get("Location");
  if (!init.ok || !session) throw new Error(`YouTube upload init failed: ${init.status} ${(await init.text()).slice(0, 300)}`);
  await updateLongform(env.DB, lf.source_id, {
    yt_status: "uploading", yt_session: await seal(env, session), yt_offset: 0, yt_privacy: privacy, yt_error: null, yt_video_id: null,
  });
}

/** Push the next chunks of every in-progress upload. Runs from the every-minute cron. */
export async function advanceYouTubeUploads(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT * FROM longform WHERE yt_status = 'uploading' LIMIT 3").all<LongformRow>();
  for (const row of results) {
    // Claim it so an overlapping tick (uploads can outlast a minute) doesn't send the same chunk twice.
    const now = Date.now();
    const lf = await env.DB.prepare(
      `UPDATE longform SET yt_lock_until = ? WHERE source_id = ? AND yt_status = 'uploading'
         AND (yt_lock_until IS NULL OR yt_lock_until < ?) RETURNING *`,
    ).bind(now + 10 * 60_000, row.source_id, now).first<LongformRow>();
    if (!lf) continue;
    try {
      await pushChunks(env, lf);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
      // A 404/410 means the session expired (YouTube keeps them ~1 week): start over from the dashboard.
      const fatal = /→ (404|410)\b/.test(msg);
      await updateLongform(env.DB, lf.source_id, fatal ? { yt_status: "failed", yt_error: msg, yt_session: null } : { yt_error: msg });
    } finally {
      await updateLongform(env.DB, lf.source_id, { yt_lock_until: null });
    }
  }
}

async function pushChunks(env: Env, lf: LongformRow) {
  if (!lf.yt_session) throw new Error("no upload session");
  const session = await open(env, lf.yt_session);
  let offset = lf.yt_offset;
  for (let i = 0; i < CHUNKS_PER_TICK && offset < lf.size; i++) {
    const length = Math.min(CHUNK, lf.size - offset);
    const obj = await env.CLIPS.get(lf.video_key, { range: { offset, length } });
    if (!obj) throw new Error(`missing R2 object ${lf.video_key}`);
    const { readable, writable } = new FixedLengthStream(length);
    const pump = obj.body.pipeTo(writable);
    const res = await fetch(session, {
      method: "PUT",
      headers: { "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${lf.size}` },
      body: readable,
    });
    await pump;
    if (res.status === 308) {
      // "Range: bytes=0-N" = what YouTube has; continue from N+1 (it may have kept less than we sent).
      const m = /bytes=0-(\d+)/.exec(res.headers.get("Range") ?? "");
      offset = m ? Number(m[1]) + 1 : offset;
      await updateLongform(env.DB, lf.source_id, { yt_offset: offset, yt_error: null });
      continue;
    }
    if (res.ok) {
      const video = await res.json<{ id: string }>();
      await updateLongform(env.DB, lf.source_id, {
        yt_status: "uploaded", yt_video_id: video.id, yt_offset: lf.size, yt_session: null, yt_error: null,
      });
      return;
    }
    throw new Error(`YouTube chunk at ${offset} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

// ── Twitch / Kick links (pasted after a manual upload)

export function parseTwitchUrl(url: string): { url: string; videoId: string } | null {
  const m = /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/(?:[\w]+\/)?videos?\/(\d+)/i.exec(url.trim());
  return m ? { url: `https://www.twitch.tv/videos/${m[1]}`, videoId: m[1] } : null;
}

export function parseKickUrl(url: string): string | null {
  const u = url.trim();
  return /^https?:\/\/(?:www\.)?kick\.com\/[\w-]+\/videos?\/[\w-]+/i.test(u) ? u : null;
}
