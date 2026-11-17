/**
 * Dashboard users = the email rules of one Cloudflare Access group ("Clipper users"), which the
 * dashboard's Access policy includes. Managed through the Cloudflare API with CF_API_TOKEN
 * (Account → Access: Organizations, Identity Providers, and Groups → Edit).
 */
const API = "https://api.cloudflare.com/client/v4";

type Rule = Record<string, unknown> & { email?: { email: string } };
type Group = { id: string; name: string; include: Rule[]; exclude?: Rule[]; require?: Rule[] };

export const accessConfigured = (env: Env) => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ACCESS_GROUP_ID);

async function cf<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!res.ok || !j.success) throw new Error(`Cloudflare API ${path}: ${j.errors?.map((e) => e.message).join("; ") || res.status}`);
  return j.result as T;
}

const getGroup = (env: Env) => cf<Group>(env, "GET", `/access/groups/${env.CF_ACCESS_GROUP_ID}`);

export async function listUsers(env: Env): Promise<string[]> {
  return (await getGroup(env)).include.map((r) => r.email?.email).filter((e): e is string => !!e).sort();
}

/** Rewrite the group's email rules, keeping any non-email rules exactly as they are. */
async function saveEmails(env: Env, g: Group, emails: string[]) {
  const others = g.include.filter((r) => !r.email);
  await cf(env, "PUT", `/access/groups/${g.id}`, {
    name: g.name,
    include: [...others, ...emails.map((email) => ({ email: { email } }))],
    exclude: g.exclude ?? [],
    require: g.require ?? [],
  });
}

export async function addUser(env: Env, email: string): Promise<void> {
  const g = await getGroup(env);
  const emails = g.include.map((r) => r.email?.email).filter((e): e is string => !!e);
  if (emails.some((e) => e.toLowerCase() === email.toLowerCase())) return;
  await saveEmails(env, g, [...emails, email]);
}

/** Remove from the group, then end their current sessions so access stops now, not at session expiry. */
export async function removeUser(env: Env, email: string): Promise<void> {
  const g = await getGroup(env);
  const emails = g.include.map((r) => r.email?.email).filter((e): e is string => !!e);
  await saveEmails(env, g, emails.filter((e) => e.toLowerCase() !== email.toLowerCase()));
  await cf(env, "POST", "/access/organizations/revoke_user", { email }).catch(() => {
    /* best effort: without it the session just runs out */
  });
}
