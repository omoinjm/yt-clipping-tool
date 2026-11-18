/**
 * Twitch: no upload API, so long-form videos are uploaded by hand and their link pasted in the dashboard.
 * View counts come from Helix "Get Videos" with an app access token (client credentials, no user login).
 */
import type { Stats } from "../youtube";

let cached: { token: string; until: number } | null = null;

export const twitchConfigured = (env: Env) => !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);

async function appToken(env: Env): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  const t = await res.json<{ access_token?: string; expires_in?: number; message?: string }>();
  if (!res.ok || !t.access_token) throw new Error(`Twitch token: ${t.message ?? res.status}`);
  cached = { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

/** View counts for up to 100 Twitch video ids. */
export async function videoStats(env: Env, ids: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  if (!ids.length) return out;
  if (!twitchConfigured(env)) throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET aren't set on the Worker");
  const q = new URLSearchParams();
  for (const id of ids.slice(0, 100)) q.append("id", id);
  const res = await fetch(`https://api.twitch.tv/helix/videos?${q}`, {
    headers: { Authorization: `Bearer ${await appToken(env)}`, "Client-Id": env.TWITCH_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`Twitch Get Videos: ${res.status} ${(await res.text()).slice(0, 200)}`);
  for (const v of (await res.json<{ data: { id: string; view_count: number }[] }>()).data)
    out.set(v.id, { views: v.view_count });
  return out;
}
