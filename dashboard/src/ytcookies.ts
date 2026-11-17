/**
 * YouTube download cookies (Netscape cookies.txt), managed on the dashboard's Settings page.
 * YouTube asks datacenter IPs (the AWS GPU job) to "sign in to confirm you're not a bot"; a spare
 * account's cookies get past that. Stored encrypted in `settings`; the job reads them through the
 * internal API (bearer token), never through job parameters (which Batch shows in plain text).
 */
import { open, seal } from "./social/tokens";

const KEY = "yt_cookies";
const META_KEY = "yt_cookies_meta";
export const MAX_COOKIE_BYTES = 100_000;

export type CookieMeta = {
  saved_at: string; saved_by: string; youtube: number; total: number;
  logged_in: boolean; expires_at: number | null; // epoch seconds of the earliest login cookie expiry
};

/** Parse and sanity-check a cookies.txt export. Returns problems (empty = OK) plus a summary. */
export function inspectCookies(text: string): { errors: string[]; meta: Omit<CookieMeta, "saved_at" | "saved_by"> } {
  const errors: string[] = [];
  if (text.length > MAX_COOKIE_BYTES) errors.push("That file is too large for a cookies.txt export.");
  let total = 0, youtube = 0, loggedIn = false;
  let expires: number | null = null;
  const LOGIN = new Set(["LOGIN_INFO", "SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID"]);
  for (let line of text.split(/\r?\n/)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length); // HttpOnly cookies are real entries
    else if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    total++;
    const [domain, , , , exp, name] = f;
    if (/(^|\.)youtube\.com$/i.test(domain)) {
      youtube++;
      if (LOGIN.has(name)) {
        loggedIn = true;
        const e = Number(exp);
        if (e > 0) expires = expires == null ? e : Math.min(expires, e);
      }
    }
  }
  if (total === 0) errors.push("No cookies found. Paste the whole cookies.txt (Netscape format) file, starting with “# Netscape HTTP Cookie File”.");
  else if (youtube === 0) errors.push("This file has no youtube.com cookies. Export it while on youtube.com.");
  else if (!loggedIn) errors.push("These YouTube cookies aren't from a signed-in session (no login cookies), so they won't get past the bot check. Sign in first, then export.");
  return { errors, meta: { total, youtube, logged_in: loggedIn, expires_at: expires } };
}

export async function saveCookies(env: Env, text: string, by: string): Promise<void> {
  const { meta } = inspectCookies(text);
  const full: CookieMeta = { ...meta, saved_at: new Date().toISOString(), saved_by: by };
  const upsert = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')";
  await env.DB.batch([
    env.DB.prepare(upsert).bind(KEY, await seal(env, text)),
    env.DB.prepare(upsert).bind(META_KEY, JSON.stringify(full)),
  ]);
}

export async function getCookies(env: Env): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string | null }>();
  return r?.value ? open(env, r.value) : null;
}

export async function cookieMeta(db: D1Database): Promise<CookieMeta | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(META_KEY).first<{ value: string | null }>();
  try {
    return r?.value ? (JSON.parse(r.value) as CookieMeta) : null;
  } catch {
    return null;
  }
}

export async function deleteCookies(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key IN (?, ?)").bind(KEY, META_KEY).run();
}
