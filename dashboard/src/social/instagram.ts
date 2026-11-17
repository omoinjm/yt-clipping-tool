/**
 * Instagram API with Instagram Login: publish clips as Reels to a professional (Business/Creator) account.
 * Docs: developers.facebook.com/docs/instagram-platform/content-publishing (+ business-login).
 * Instagram fetches the video itself from `video_url`: a short-lived presigned R2 link, so the
 * dashboard stays behind Cloudflare Access.
 */
import { AwsClient } from "aws4fetch";
import { getAccount, saveAccount, type Account } from "./tokens";

const GRAPH = "https://graph.instagram.com";
const VERSION = "v27.0";
export const IG_SCOPES = "instagram_business_basic,instagram_business_content_publish";
const DAY = 86_400_000;

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
  const q = new URLSearchParams({ client_id: env.IG_APP_ID, redirect_uri: redirectUri, response_type: "code", scope: IG_SCOPES, state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

export async function connect(env: Env, code: string, redirectUri: string): Promise<Account> {
  // 1) code → short-lived token (1 h)
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri,
      code: code.replace(/#_$/, ""),
    }),
  });
  type Short = { access_token: string; user_id: string | number } & { error_message?: string };
  const raw = (await res.json()) as Short | { data: Short[] } & { error_message?: string };
  const short = "data" in raw ? raw.data[0] : raw;
  if (!res.ok || !short?.access_token) throw new Error(`Instagram login: ${raw.error_message ?? res.status}`);

  // 2) short-lived → long-lived token (60 days)
  const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env.IG_APP_SECRET, access_token: short.access_token });
  const longRes = await fetch(`${GRAPH}/access_token?${q}`);
  const long = (await longRes.json()) as { access_token: string; expires_in: number } & GraphError;
  if (!longRes.ok || !long.access_token) throw new Error(`Instagram token exchange: ${long.error?.message ?? longRes.status}`);

  const me = await graph<{ user_id: string; username: string }>("GET", "/me?fields=user_id,username", long.access_token);
  const acct: Account = {
    platform: "instagram", accountId: String(me.user_id ?? short.user_id), accountName: me.username,
    accessToken: long.access_token, accessExpiresAt: Date.now() + long.expires_in * 1000, refreshToken: null, refreshExpiresAt: null,
  };
  await saveAccount(env, acct);
  return acct;
}

/** The long-lived token, refreshed for another 60 days once it's within 10 days of expiring. */
async function account(env: Env): Promise<Account> {
  const acct = await getAccount(env, "instagram");
  if (!acct) throw new Error("Instagram isn't connected: open Accounts → Connect Instagram");
  const left = acct.accessExpiresAt - Date.now();
  if (left <= 0) throw new Error("Instagram session expired: reconnect on the Accounts page");
  if (left < 10 * DAY) {
    const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: acct.accessToken });
    const res = await fetch(`${GRAPH}/refresh_access_token?${q}`);
    const t = (await res.json()) as { access_token?: string; expires_in?: number };
    if (res.ok && t.access_token && t.expires_in) {
      const fresh = { ...acct, accessToken: t.access_token, accessExpiresAt: Date.now() + t.expires_in * 1000 };
      await saveAccount(env, fresh);
      return fresh;
    }
  }
  return acct;
}

/** Keep the token alive even when nothing is posted for weeks (called from the cron). */
export async function keepAlive(env: Env): Promise<void> {
  if (await getAccount(env, "instagram").catch(() => null)) await account(env);
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
