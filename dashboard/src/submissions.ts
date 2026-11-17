/** Public upload link: settings, submission records, Turnstile, rate limiting. */
import { VIDEO_EXTS } from "./sources";

export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // 5 GB
export const CHUNK_BYTES = 32 * 1024 * 1024; // under the Worker request-body limit
export const UPLOADS_PER_IP_PER_HOUR = 5;

export type SubmissionRow = {
  id: string; status: "uploading" | "received" | "accepted" | "rejected";
  name: string; email: string; title: string | null; notes: string | null; credit: string | null;
  filename: string; size: number; content_type: string | null; r2_key: string;
  upload_id: string | null; upload_secret: string | null; ip_hash: string | null; source_id: string | null;
  created_at: string; updated_at: string;
};

const rand = (bytes: number) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── link token (settings table)

export async function getUploadToken(db: D1Database): Promise<string | null> {
  return (await db.prepare("SELECT value FROM settings WHERE key = 'upload_token'").first<{ value: string | null }>())?.value ?? null;
}

/** New random token (the old link stops working), or null to turn the link off. */
export async function setUploadToken(db: D1Database, on: boolean): Promise<string | null> {
  const token = on ? rand(18) : null;
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES ('upload_token', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).bind(token).run();
  return token;
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

/** Constant-time string comparison (hash both so lengths match). */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}

/** Salted so the stored value can't be reversed to an IP; only used to count recent uploads. */
export async function ipHash(env: Env, ip: string): Promise<string> {
  const h = new Uint8Array(await sha256(`${env.TOKEN_ENC_KEY ?? "clipper"}:${ip}`));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Turnstile

export async function verifyTurnstile(env: Env, token: string, ip: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // not configured (local dev); production sets it
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  const r = await res.json<{ success: boolean }>().catch(() => ({ success: false }));
  return r.success === true;
}

// ── submissions

export type NewSubmission = {
  name: string; email: string; title: string; notes: string; credit: string; rights: boolean;
  filename: string; size: number; contentType: string;
};

export function validateSubmission(s: NewSubmission): string[] {
  const errors: string[] = [];
  if (!s.name.trim() || s.name.length > 100) errors.push("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) || s.email.length > 200) errors.push("Enter a valid email address.");
  if (s.title.length > 150) errors.push("Title is too long.");
  if (s.notes.length > 2000) errors.push("Notes are too long.");
  if (s.credit.length > 200) errors.push("Credit line is too long.");
  if (!s.rights) errors.push("Please confirm you have the rights to this video.");
  const ext = s.filename.slice(s.filename.lastIndexOf(".")).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) errors.push(`Upload a video file (${VIDEO_EXTS.join(", ")}).`);
  if (!(s.size > 0)) errors.push("The file is empty.");
  if (s.size > MAX_UPLOAD_BYTES) errors.push("The file is larger than 5 GB.");
  return errors;
}

export async function recentUploadsFrom(db: D1Database, ipH: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
    .bind(ipH).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function createSubmission(env: Env, s: NewSubmission, ipH: string): Promise<{ id: string; uploadId: string; secret: string }> {
  const id = `sub-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${rand(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  const ext = s.filename.slice(s.filename.lastIndexOf(".")).toLowerCase();
  const key = `submissions/${id}/source${ext}`; // server-chosen: the browser never picks storage paths
  const mpu = await env.CLIPS.createMultipartUpload(key, { httpMetadata: { contentType: s.contentType || "video/mp4" } });
  const secret = rand(24);
  await env.DB.prepare(
    `INSERT INTO submissions (id, name, email, title, notes, credit, filename, size, content_type, r2_key, upload_id, upload_secret, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, s.name.trim(), s.email.trim(), s.title.trim() || null, s.notes.trim() || null, s.credit.trim() || null,
    s.filename.slice(0, 200), s.size, s.contentType.slice(0, 100) || null, key, mpu.uploadId, secret, ipH,
  ).run();
  return { id, uploadId: mpu.uploadId, secret };
}

export function getSubmission(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
}

export async function listSubmissions(db: D1Database): Promise<SubmissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM submissions WHERE status != 'uploading' OR created_at > datetime('now', '-1 day')
       ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'uploading' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`,
    )
    .all<SubmissionRow>();
  return results;
}

export async function setSubmission(db: D1Database, id: string, f: Partial<Pick<SubmissionRow, "status" | "source_id" | "upload_id" | "upload_secret">>) {
  const cols = Object.keys(f);
  await db.prepare(`UPDATE submissions SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...Object.values(f), id).run();
}

/** Hourly: abandon uploads that never finished (abort the R2 multipart, drop the row). */
export async function cleanupAbandoned(env: Env): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT id, r2_key, upload_id FROM submissions WHERE status = 'uploading' AND created_at < datetime('now', '-1 day') LIMIT 50")
    .all<{ id: string; r2_key: string; upload_id: string | null }>();
  for (const r of results) {
    if (r.upload_id) await env.CLIPS.resumeMultipartUpload(r.r2_key, r.upload_id).abort().catch(() => {});
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(r.id).run();
  }
}

export const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
