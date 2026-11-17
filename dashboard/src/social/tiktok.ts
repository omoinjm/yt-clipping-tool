/**
 * TikTok Content Posting API: direct post (caption + privacy) or upload to the creator's drafts inbox.
 * Docs: developers.tiktok.com/doc/content-posting-api-reference-direct-post (+ media transfer guide).
 * Until the app passes TikTok's audit, direct posts are forced to SELF_ONLY (private).
 */
import { getAccount, saveAccount, type Account } from "./tokens";

const API = "https://open.tiktokapis.com";
// Stats need video.list (Display API), which TikTok doesn't offer in Sandbox: add it here once the
// production app is approved with Display API, then reconnect. Without it, metrics just stay empty.
export const TIKTOK_SCOPES = "user.info.basic,video.publish,video.upload";
const MB = 1024 * 1024;

export type CreatorInfo = {
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

/** Plain-language versions of TikTok errors people actually hit. */
const FRIENDLY: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "TikTok only allows “Post now” on private accounts until it approves (audits) this app. Use “Send to TikTok drafts” instead.",
  spam_risk_too_many_posts: "TikTok's daily posting limit for this account was reached. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok has blocked this account from posting.",
  privacy_level_option_mismatch: "That “Who can view” option isn't available for this account.",
  reached_active_user_cap: "This app reached TikTok's daily limit of posting users. Try again tomorrow.",
};

type TikTokResp<T> = { data: T; error: { code: string; message: string; log_id?: string } };

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as TikTokResp<T> | null;
  if (!res.ok || !json || (json.error && json.error.code !== "ok"))
    throw new Error(
      FRIENDLY[json?.error?.code ?? ""] ?? `TikTok ${path}: ${json?.error?.code ?? res.status} ${json?.error?.message ?? ""}`.trim(),
    );
  return json.data;
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY, scope: TIKTOK_SCOPES, response_type: "code", redirect_uri: redirectUri, state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

type TokenResp = {
  access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string;
  error?: string; error_description?: string;
};

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResp> {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, ...params }),
  });
  const t = await res.json<TokenResp>();
  if (!res.ok || t.error || !t.access_token) throw new Error(`TikTok token: ${t.error ?? res.status} ${t.error_description ?? ""}`);
  return t;
}

function toAccount(t: TokenResp, name: string | null): Account {
  const now = Date.now();
  return {
    platform: "tiktok", accountId: t.open_id, accountName: name, accessToken: t.access_token,
    accessExpiresAt: now + t.expires_in * 1000, refreshToken: t.refresh_token, refreshExpiresAt: now + t.refresh_expires_in * 1000,
  };
}

export async function connect(env: Env, code: string, redirectUri: string): Promise<Account> {
  const t = await tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: redirectUri });
  let name: string | null = null;
  try {
    const res = await fetch(`${API}/v2/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    name = (await res.json<TikTokResp<{ user: { display_name?: string } }>>()).data?.user?.display_name ?? null;
  } catch {
    /* name is cosmetic */
  }
  const acct = toAccount(t, name);
  await saveAccount(env, acct);
  return acct;
}

/** A valid access token (24 h lifetime), refreshed with the 365-day refresh token when needed. */
async function accessToken(env: Env): Promise<{ token: string; acct: Account }> {
  const acct = await getAccount(env, "tiktok");
  if (!acct) throw new Error("TikTok isn't connected: open Accounts → Connect TikTok");
  if (acct.accessExpiresAt - Date.now() > 5 * 60_000) return { token: acct.accessToken, acct };
  if (!acct.refreshToken) throw new Error("TikTok session expired: reconnect on the Accounts page");
  const fresh = toAccount(await tokenRequest(env, { grant_type: "refresh_token", refresh_token: acct.refreshToken }), acct.accountName);
  await saveAccount(env, fresh);
  return { token: fresh.accessToken, acct: fresh };
}

export async function creatorInfo(env: Env): Promise<CreatorInfo> {
  const { token } = await accessToken(env);
  return call<CreatorInfo>(token, "/v2/post/publish/creator_info/query/", {});
}

/** TikTok chunk rules: 5–64 MB chunks, count = floor(size / chunk), the last chunk takes the remainder. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export type TikTokPostInput = {
  mode: "direct" | "draft";
  caption: string;
  privacy: string;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
};

/** Upload the clip from R2 and start the post. Returns the publish_id to poll. */
export async function post(env: Env, videoKey: string, input: TikTokPostInput): Promise<string> {
  const { token } = await accessToken(env);
  const head = await env.CLIPS.head(videoKey);
  if (!head) throw new Error(`missing R2 object ${videoKey}`);
  const { chunkSize, count } = chunkPlan(head.size);
  const source_info = { source: "FILE_UPLOAD", video_size: head.size, chunk_size: chunkSize, total_chunk_count: count };

  let init: { publish_id: string; upload_url: string };
  if (input.mode === "draft") {
    init = await call(token, "/v2/post/publish/inbox/video/init/", { source_info });
  } else {
    const info = await call<CreatorInfo>(token, "/v2/post/publish/creator_info/query/", {});
    if (!info.privacy_level_options.includes(input.privacy))
      throw new Error(`TikTok privacy “${input.privacy}” isn't allowed for this account (options: ${info.privacy_level_options.join(", ")})`);
    init = await call(token, "/v2/post/publish/video/init/", {
      post_info: {
        title: input.caption,
        privacy_level: input.privacy,
        disable_comment: info.comment_disabled || !input.allowComments,
        disable_duet: info.duet_disabled || !input.allowDuet,
        disable_stitch: info.stitch_disabled || !input.allowStitch,
        video_cover_timestamp_ms: 1000,
      },
      source_info,
    });
  }

  // Sequential chunk PUTs, each streamed from an R2 range read.
  for (let i = 0; i < count; i++) {
    const offset = i * chunkSize;
    const length = i === count - 1 ? head.size - offset : chunkSize;
    const obj = await env.CLIPS.get(videoKey, { range: { offset, length } });
    if (!obj) throw new Error(`missing R2 object ${videoKey}`);
    const { readable, writable } = new FixedLengthStream(length);
    const pump = obj.body.pipeTo(writable);
    const res = await fetch(init.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(length),
        "Content-Range": `bytes ${offset}-${offset + length - 1}/${head.size}`,
      },
      body: readable,
    });
    await pump;
    if (!(res.ok || res.status === 206)) throw new Error(`TikTok upload chunk ${i + 1}/${count}: ${res.status} ${await res.text()}`);
  }
  return init.publish_id;
}

export type TikTokStatus = { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] };

/** Poll a post. When it's public, also returns its link (private posts have no public id). */
export async function status(env: Env, publishId: string): Promise<TikTokStatus & { postId?: string; url?: string }> {
  const { token } = await accessToken(env);
  const s = await call<TikTokStatus>(token, "/v2/post/publish/status/fetch/", { publish_id: publishId });
  const id = s.publicaly_available_post_id?.[0];
  if (id == null) return s;
  let username = "";
  try {
    username = (await call<CreatorInfo>(token, "/v2/post/publish/creator_info/query/", {})).creator_username;
  } catch {
    /* fall back to a link without the handle */
  }
  return { ...s, postId: String(id), url: `https://www.tiktok.com/@${username}/video/${id}` };
}

/** Public stats for up to 20 posted videos. Needs the video.list scope (reconnect TikTok after adding it). */
export async function videoStats(env: Env, ids: string[]): Promise<Map<string, import("../youtube").Stats>> {
  const out = new Map<string, import("../youtube").Stats>();
  if (!ids.length) return out;
  const { token } = await accessToken(env);
  type V = { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number };
  const data = await call<{ videos: V[] }>(token, "/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", {
    filters: { video_ids: ids.slice(0, 20) },
  });
  for (const v of data.videos ?? [])
    out.set(String(v.id), { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count });
  return out;
}
