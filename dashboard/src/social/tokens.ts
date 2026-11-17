/** Connected TikTok / Instagram accounts, stored in D1 with tokens encrypted (AES-GCM, TOKEN_ENC_KEY). */

/** Where clips are posted through the posts table. */
export type Platform = "tiktok" | "instagram";
/** Accounts that can be connected (YouTube uploads are tracked on clips.youtube_id instead). */
export type AccountPlatform = Platform | "youtube";

export type Account = {
  platform: AccountPlatform;
  accountId: string;
  accountName: string | null;
  accessToken: string;
  accessExpiresAt: number; // epoch ms
  refreshToken: string | null;
  refreshExpiresAt: number | null;
};

type Row = {
  platform: AccountPlatform; account_id: string; account_name: string | null; access_token: string;
  access_expires_at: number; refresh_token: string | null; refresh_expires_at: number | null; updated_at: string;
};

const keys = new Map<string, Promise<CryptoKey>>();

function key(env: Env): Promise<CryptoKey> {
  const raw = env.TOKEN_ENC_KEY;
  if (!raw) throw new Error("TOKEN_ENC_KEY is not set (32 random bytes, base64): see README → Social publishing");
  let k = keys.get(raw);
  if (!k) {
    const bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
    if (bytes.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded");
    k = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(raw, k);
  }
  return k;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function seal(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), new TextEncoder().encode(plain));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function open(env: Env, sealed: string): Promise<string> {
  const [iv, ct] = sealed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

export async function getAccount(env: Env, platform: AccountPlatform): Promise<Account | null> {
  const r = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE platform = ?").bind(platform).first<Row>();
  if (!r) return null;
  return {
    platform,
    accountId: r.account_id,
    accountName: r.account_name,
    accessToken: await open(env, r.access_token),
    accessExpiresAt: r.access_expires_at,
    refreshToken: r.refresh_token ? await open(env, r.refresh_token) : null,
    refreshExpiresAt: r.refresh_expires_at,
  };
}

/** Name of the connected account (no decryption), for the UI. */
export async function accountNames(env: Env): Promise<Partial<Record<AccountPlatform, string>>> {
  const { results } = await env.DB.prepare("SELECT platform, account_id, account_name FROM oauth_tokens")
    .all<{ platform: AccountPlatform; account_id: string; account_name: string | null }>();
  return Object.fromEntries(results.map((r) => [r.platform, r.account_name ?? r.account_id]));
}

export async function saveAccount(env: Env, a: Account): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (platform, account_id, account_name, access_token, access_expires_at, refresh_token, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET account_id = excluded.account_id, account_name = excluded.account_name,
       access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,
       refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at, updated_at = datetime('now')`,
  ).bind(
    a.platform, a.accountId, a.accountName, await seal(env, a.accessToken), a.accessExpiresAt,
    a.refreshToken ? await seal(env, a.refreshToken) : null, a.refreshExpiresAt,
  ).run();
}

export async function deleteAccount(env: Env, platform: AccountPlatform): Promise<void> {
  await env.DB.prepare("DELETE FROM oauth_tokens WHERE platform = ?").bind(platform).run();
}
