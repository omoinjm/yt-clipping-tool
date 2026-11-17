/**
 * Instagram API with Unified Login (Facebook Login for Business): publish clips as Reels to a
 * professional (Business/Creator) account owned by a business portfolio.
 * Docs: developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
 * (+ content-publishing). Login uses a Login for Business configuration (META_CONFIG_ID); the token
 * is a Business Integration System User token (pick "never expires" in the configuration).
 * Instagram fetches the video itself from `video_url`: a short-lived presigned R2 link, so the
 * dashboard stays behind Cloudflare Access.
 */
import { AwsClient } from "aws4fetch";
import { getAccount, saveAccount, type Account } from "./tokens";

const GRAPH = "https://graph.facebook.com";
const VERSION = "v27.0";
const NEVER = Date.UTC(9999, 0, 1);

type GraphError = { error?: { message: string; type?: string; code?: number } };

async function graph<T>(method: "GET" | "POST", path: string, token: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GRAPH}/${VERSION}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || json.error) throw new Error(`Instagram ${path.split("?")[0]}: ${json.error?.message ?? res.status}`);
  return json;
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  if (!env.META_APP_ID || !env.META_CONFIG_ID) throw new Error("META_APP_ID / META_CONFIG_ID are not set on the Worker");
  const q = new URLSearchParams({
    client_id: env.META_APP_ID, config_id: env.META_CONFIG_ID, redirect_uri: redirectUri, response_type: "code", state,
  });
  return `https://www.facebook.com/dialog/oauth?${q}`;
}

export async function connect(env: Env, code: string, redirectUri: string): Promise<Account> {
  const q = new URLSearchParams({
    client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code: code.replace(/#_$/, ""),
  });
  const res = await fetch(`${GRAPH}/${VERSION}/oauth/access_token?${q}`);
  const t = (await res.json()) as { access_token?: string; expires_in?: number } & GraphError;
  if (!res.ok || !t.access_token) throw new Error(`Instagram login: ${t.error?.message ?? res.status}`);

  // With this token /me is the integration's system user; the shared Instagram account is listed here.
  const { data } = await graph<{ data: { id: string; username: string }[] }>(
    "GET", "/me/assigned_instagram_accounts?fields=id,username", t.access_token,
  );
  const ig = data?.[0];
  if (!ig) throw new Error("No Instagram account was shared with the app. Connect again and select the Instagram account.");
  const acct: Account = {
    platform: "instagram", accountId: ig.id, accountName: ig.username, accessToken: t.access_token,
    accessExpiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : NEVER, refreshToken: null, refreshExpiresAt: null,
  };
  await saveAccount(env, acct);
  return acct;
}

async function account(env: Env): Promise<Account> {
  const acct = await getAccount(env, "instagram");
  if (!acct) throw new Error("Instagram isn't connected: open Accounts → Connect Instagram");
  if (acct.accessExpiresAt <= Date.now()) throw new Error("Instagram access expired: reconnect on the Accounts page");
  return acct;
}

/** Presigned GET for an R2 object via its S3 API (Instagram downloads the video from this). */
async function presign(env: Env, key: string, seconds = 7200): Promise<string> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set on the Worker");
  const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", String(seconds));
  return (await r2.sign(url.toString(), { method: "GET", aws: { signQuery: true } })).url;
}

/** Create the Reel container. Returns its id; Instagram processes the video asynchronously. */
export async function post(env: Env, videoKey: string, caption: string, shareToFeed: boolean): Promise<string> {
  const acct = await account(env);
  const container = await graph<{ id: string }>("POST", `/${acct.accountId}/media`, acct.accessToken, {
    media_type: "REELS",
    video_url: await presign(env, videoKey),
    caption,
    share_to_feed: shareToFeed,
  });
  return container.id;
}

/**
 * Advance a container: publish it once processing is FINISHED.
 * Returns null while still processing.
 */
export async function advance(
  env: Env,
  containerId: string,
): Promise<null | { ok: true; postId: string; url: string | null } | { ok: false; error: string }> {
  const acct = await account(env);
  const c = await graph<{ status_code: string; status?: string }>("GET", `/${containerId}?fields=status_code,status`, acct.accessToken);
  if (c.status_code === "IN_PROGRESS") return null;
  if (c.status_code === "ERROR" || c.status_code === "EXPIRED")
    return { ok: false, error: `Instagram processing ${c.status_code}${c.status ? `: ${c.status}` : ""}` };
  let mediaId: string;
  if (c.status_code === "PUBLISHED") {
    mediaId = containerId; // already published by an earlier tick; id unknown, keep the container's
  } else {
    mediaId = (await graph<{ id: string }>("POST", `/${acct.accountId}/media_publish`, acct.accessToken, { creation_id: containerId })).id;
  }
  let url: string | null = null;
  try {
    url = (await graph<{ permalink?: string }>("GET", `/${mediaId}?fields=permalink`, acct.accessToken)).permalink ?? null;
  } catch {
    /* link is cosmetic */
  }
  return { ok: true, postId: mediaId, url };
}

/**
 * Likes and comments always; views/shares/saves when the configuration includes instagram_manage_insights.
 */
export async function mediaStats(env: Env, mediaId: string): Promise<import("../youtube").Stats> {
  const acct = await account(env);
  const m = await graph<{ like_count?: number; comments_count?: number }>("GET", `/${mediaId}?fields=like_count,comments_count`, acct.accessToken);
  const stats: import("../youtube").Stats = { likes: m.like_count, comments: m.comments_count };
  try {
    type Ins = { data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
    const ins = await graph<Ins>("GET", `/${mediaId}/insights?metric=views,shares,saved`, acct.accessToken);
    const get = (n: string) => { const d = ins.data.find((x) => x.name === n); return d?.total_value?.value ?? d?.values?.[0]?.value; };
    Object.assign(stats, { views: get("views"), shares: get("shares"), saves: get("saved") });
  } catch {
    /* no insights permission: likes/comments only */
  }
  return stats;
}
