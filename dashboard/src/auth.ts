import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

import type { ChannelRow } from "./channels";

type AppEnv = { Bindings: Env; Variables: { email: string; channels: ChannelRow[]; scope: string } };

// One JWKS fetcher per team domain; jose caches the keys internally (immutable config, not request state).
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verify the Cloudflare Access JWT on every UI request (defense in depth behind Access itself). */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const team = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;
  if (!team || !aud) {
    // Local dev only: refuse on anything that isn't localhost.
    const host = new URL(c.req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return c.text("Access not configured", 500);
    c.set("email", "dev@localhost");
    return next();
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return c.text("Forbidden", 403);
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud });
    c.set("email", typeof payload.email === "string" ? payload.email : "service");
  } catch {
    return c.text("Forbidden", 403);
  }
  return next();
};

async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  // Hash first so lengths always match, then compare in constant time.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** Bearer token for the machine API used by the CLI and the Batch job. */
export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = c.env.INTERNAL_API_TOKEN;
  const got = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || !(await timingSafeEqualStr(got, expected))) return c.json({ error: "unauthorized" }, 401);
  return next();
};

export type { AppEnv };
