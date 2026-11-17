import type { ClipRow } from "./db";
import { getAccount, saveAccount, type Account } from "./social/tokens";

/**
 * YouTube: the channel is connected on the Accounts page (Google OAuth, "Web application" client).
 * For a brand channel like @shukela_clips, pick that channel on Google's account chooser.
 */
export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly", // to show which channel is connected
].join(" ");

export function buildDescription(description: string, credit: string | null, tags: string[]): string {
  const parts = [description.trim()];
  if (credit) parts.push(`Original: ${credit}`);
  const hashtags = tags.slice(0, 3).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  parts.push(`#Shorts ${hashtags}`.trim());
  return parts.filter(Boolean).join("\n\n");
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env.YT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES,
    access_type: "offline", // refresh token
    prompt: "consent select_account", // always show the account/channel chooser and return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type GoogleToken = { access_token: string; expires_in: number; refresh_token?: string; error?: string; error_description?: string };

async function tokenRequest(env: Env, params: Record<string, string>): Promise<GoogleToken> {
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET are not set on the Worker");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, ...params }),
  });
  const t = await res.json<GoogleToken>();
  if (!res.ok || !t.access_token) throw new Error(`Google token: ${t.error ?? res.status} ${t.error_description ?? ""}`.trim());
  return t;
}

/** The channel the token uploads to: `@handle` (or title) and id. */
async function myChannel(token: string): Promise<{ id: string; name: string }> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`YouTube channels.list: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const ch = (await res.json<{ items?: { id: string; snippet: { title: string; customUrl?: string } }[] }>()).items?.[0];
  if (!ch) throw new Error("This Google account has no YouTube channel. Pick the channel (brand account) on the chooser.");
  return { id: ch.id, name: ch.snippet.customUrl ? `${ch.snippet.customUrl} (${ch.snippet.title})` : ch.snippet.title };
}

export async function connect(env: Env, code: string, redirectUri: string): Promise<Account> {
  const t = await tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!t.refresh_token) throw new Error("Google returned no refresh token; remove the app's access at myaccount.google.com/permissions and connect again");
  const ch = await myChannel(t.access_token);
  const acct: Account = {
    platform: "youtube", accountId: ch.id, accountName: ch.name, accessToken: t.access_token,
    accessExpiresAt: Date.now() + t.expires_in * 1000, refreshToken: t.refresh_token, refreshExpiresAt: null,
  };
  await saveAccount(env, acct);
  return acct;
}

async function accessToken(env: Env): Promise<string> {
  const acct = await getAccount(env, "youtube");
  if (!acct?.refreshToken) throw new Error("YouTube isn't connected: open Accounts → Connect YouTube");
  if (acct.accessExpiresAt - Date.now() > 5 * 60_000) return acct.accessToken;
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: acct.refreshToken });
  await saveAccount(env, { ...acct, accessToken: t.access_token, accessExpiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Stream a clip from R2 into a YouTube resumable upload. Returns the YouTube video id. */
export async function uploadToYouTube(
  env: Env,
  clip: ClipRow,
  credit: string | null,
  privacy: "private" | "unlisted" | "public",
): Promise<string> {
  if (!clip.video_key) throw new Error("clip has no video in R2 yet");
  const head = await env.CLIPS.head(clip.video_key);
  if (!head) throw new Error(`missing R2 object ${clip.video_key}`);

  const token = await accessToken(env);
  const tags: string[] = JSON.parse(clip.tags || "[]");
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(head.size),
      },
      body: JSON.stringify({
        snippet: {
          title: (clip.title ?? clip.id).slice(0, 100),
          description: buildDescription(clip.description ?? "", credit, tags).slice(0, 5000),
          tags: tags.slice(0, 15),
          categoryId: env.YT_CATEGORY_ID || "22",
        },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    },
  );
  const uploadUrl = init.headers.get("Location");
  if (!init.ok || !uploadUrl) throw new Error(`YouTube upload init failed: ${init.status} ${await init.text()}`);

  const obj = await env.CLIPS.get(clip.video_key);
  if (!obj) throw new Error(`missing R2 object ${clip.video_key}`);
  // FixedLengthStream lets fetch send a streamed body with a known Content-Length (no buffering).
  const { readable, writable } = new FixedLengthStream(obj.size);
  const pump = obj.body.pipeTo(writable);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(obj.size) },
    body: readable,
  });
  await pump;
  if (!put.ok) throw new Error(`YouTube upload failed: ${put.status} ${await put.text()}`);
  const video = await put.json<{ id: string }>();
  return video.id;
}
