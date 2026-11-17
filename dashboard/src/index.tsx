import { Hono, type Context } from "hono";
import { requireAccess, requireToken, type AppEnv } from "./auth";
import * as db from "./db";
import { ClipGrid, ClipPage, ClipToolbar, platformStates, type ClipFilter } from "./views/Clips";
import { ACTIVE_STAGES, Layout, Pill } from "./views/Layout";
import { NewSourceForm } from "./views/NewSource";
import { SourceList } from "./views/Sources";
import { sourceKeyFor, validate, type NewSource, type Permission } from "./sources";
import { describeJobs, logTail, submitBatchJob, type LogLine } from "./aws";
import { progress, syncBatch } from "./progress";
import { LogPanel, ProgressPanel, RetryForm } from "./views/Progress";
import * as youtube from "./youtube";
import { allMetrics, refreshMetrics } from "./social/metrics";
import { MetricsPage } from "./views/Metrics";
import { uploadToYouTube } from "./youtube";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { captionFor, savedCaptions, withCredit, CAPTION_MAX } from "./social/captions";
import * as instagram from "./social/instagram";
import { advancePending, clipPosts, insertPost, latestPosts } from "./social/posts";
import * as tiktok from "./social/tiktok";
import { accountNames, deleteAccount, type AccountPlatform, type Platform } from "./social/tokens";
import { AccountsPage, InstagramPanel, TikTokPanel, YouTubePanel } from "./views/Social";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(JSON.stringify({ msg: "unhandled", path: c.req.path, error: String(err) }));
  return c.req.path.startsWith("/api/") ? c.json({ error: String(err) }, 500) : c.text(`Error: ${err.message}`, 500);
});

// ───────────── machine API (CLI + Batch job) ─────────────
const api = new Hono<AppEnv>();
api.use("*", requireToken);

api.get("/sources", async (c) => c.json(await db.listSources(c.env.DB)));
api.get("/sources/:id", async (c) => {
  const s = await db.getSource(c.env.DB, c.req.param("id"));
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});
api.put("/sources/:id", async (c) => {
  await db.upsertSource(c.env.DB, c.req.param("id"), await c.req.json());
  return c.body(null, 204);
});
api.post("/sources/:id/stage", async (c) => {
  await db.setSourceStage(c.env.DB, c.req.param("id"), await c.req.json());
  return c.body(null, 204);
});
api.put("/sources/:id/clips", async (c) => {
  const clips = await c.req.json<Record<string, unknown>[]>();
  if (!Array.isArray(clips)) return c.json({ error: "expected array" }, 400);
  await db.replaceClips(c.env.DB, c.req.param("id"), clips);
  return c.body(null, 204);
});
api.get("/clips", async (c) =>
  c.json(await db.listClips(c.env.DB, { source: c.req.query("source"), stage: c.req.query("stage") })),
);
api.patch("/clips/:id", async (c) => {
  await db.updateClip(c.env.DB, c.req.param("id"), await c.req.json());
  return c.body(null, 204);
});

app.route("/api/internal", api);

// ───────────── UI (behind Cloudflare Access) ─────────────
const ui = new Hono<AppEnv>();
ui.use("*", requireAccess);

ui.get("/", async (c) => {
  const f: ClipFilter = {
    review: ["pending", "approved", "rejected"].includes(c.req.query("review") ?? "") ? c.req.query("review")! : "",
    notOn: ["youtube", "tiktok", "instagram"].includes(c.req.query("notOn") ?? "") ? c.req.query("notOn")! : "",
    source: c.req.query("source") ?? "",
    sort: c.req.query("sort") === "score" ? "score" : "",
  };
  const [all, posts, sources, metrics] = await Promise.all([
    db.listClips(c.env.DB, { review: f.review || undefined, source: f.source || undefined }),
    latestPosts(c.env.DB),
    db.listSources(c.env.DB),
    allMetrics(c.env.DB),
  ]);
  let clips = f.notOn ? all.filter((cl) => platformStates(cl, posts.get(cl.id))[f.notOn as "youtube"].state !== "live" &&
    platformStates(cl, posts.get(cl.id))[f.notOn as "youtube"].state !== "drafted") : all;
  if (f.sort === "score") clips = [...clips].sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  return c.html(
    <Layout title="Clips" email={c.get("email")} nav="clips">
      <div class="page-head">
        <div>
          <h1>Clips</h1>
          <p class="sub" style="margin:4px 0 0">Review, edit and publish. Hover a card to preview it.</p>
        </div>
        <a class="btn primary" href="/sources/new">+ New source</a>
      </div>
      <ClipToolbar f={f} sources={sources.filter((x) => (x.clip_count ?? 0) > 0).map((x) => x.id)} count={clips.length} />
      <ClipGrid clips={clips} posts={posts} metrics={metrics}
        empty={all.length ? "No clips match these filters." : undefined} />
    </Layout>,
  );
});

ui.get("/sources", async (c) => {
  const sources = await db.listSources(c.env.DB);
  const { jobs } = await syncBatch(c.env, sources); // also marks jobs that died silently as failed
  return c.html(
    <Layout title="Sources" email={c.get("email")} nav="sources" refresh={sources.some((s) => ACTIVE_STAGES.has(s.stage))}>
      <div class="page-head">
        <div>
          <h1>Sources</h1>
          <p class="sub" style="margin:4px 0 0">Long videos being turned into clips.</p>
        </div>
        <a class="btn primary" href="/sources/new">+ New source</a>
      </div>
      <SourceList sources={sources} jobs={jobs} />
    </Layout>,
  );
});

// ── New source: form, chunked upload to R2, then queue the GPU job.
ui.get("/sources/new", (c) =>
  c.html(<Layout title="New source" email={c.get("email")} nav="new"><NewSourceForm /></Layout>),
);

ui.post("/sources/new", async (c) => {
  const f = await c.req.parseBody();
  const str = (k: string) => String(f[k] ?? "").trim();
  const input: NewSource = {
    id: str("id").toLowerCase(),
    kind: str("kind") === "upload" ? "upload" : "url",
    url: str("url"),
    uploadKey: str("upload_key"),
    owner: str("owner"),
    permission: str("permission") as Permission,
    proof: str("proof"),
    credit: str("credit"),
    clips: Number(str("clips") || 5),
  };
  const errors = validate(input);
  if (!errors.length && (await db.getSource(c.env.DB, input.id))) errors.push(`ID “${input.id}” is already used.`);
  if (!errors.length && input.kind === "upload" && !(await c.env.CLIPS.head(input.uploadKey)))
    errors.push("The uploaded file wasn't found; upload it again.");
  if (errors.length) {
    return c.html(
      <Layout title="New source" email={c.get("email")} nav="new"><NewSourceForm values={input} errors={errors} /></Layout>,
      400,
    );
  }
  const origin = input.kind === "url" ? input.url : `r2://${c.env.R2_BUCKET_NAME}/${input.uploadKey}`;
  await db.upsertSource(c.env.DB, input.id, {
    origin, owner: input.owner, permission: input.permission,
    proof: input.permission === "granted" ? input.proof : null,
    credit: input.permission === "own" ? input.credit || null : input.credit,
    stage: "queued", error: null,
  });
  try {
    const jobId = await submitBatchJob(c.env, input.id, input.clips);
    await db.setSourceStage(c.env.DB, input.id, { stage: "queued", batch_job_id: jobId });
  } catch (err) {
    await db.setSourceStage(c.env.DB, input.id, { stage: "failed", error: `Could not start job: ${String(err)}` });
  }
  return c.redirect(`/sources/${input.id}`, 303);
});

// Multipart upload into R2 through the binding: no R2 keys in the browser, no size limit beyond R2's.
ui.post("/uploads", async (c) => {
  const { id, filename, contentType } = await c.req.json<{ id: string; filename: string; contentType: string }>();
  const key = sourceKeyFor(String(id).toLowerCase(), String(filename));
  if (!key) return c.json({ error: "bad id or file type" }, 400);
  if (await db.getSource(c.env.DB, String(id).toLowerCase())) return c.json({ error: "ID already used" }, 409);
  const mpu = await c.env.CLIPS.createMultipartUpload(key, { httpMetadata: { contentType: contentType || "video/mp4" } });
  return c.json({ key: mpu.key, uploadId: mpu.uploadId });
});

ui.put("/uploads/part", async (c) => {
  const key = c.req.query("key") ?? "";
  const uploadId = c.req.query("uploadId") ?? "";
  const part = Number(c.req.query("part"));
  const len = Number(c.req.header("content-length"));
  if (!key.startsWith("sources/") || !uploadId || !(part >= 1 && part <= 10000) || !c.req.raw.body || !(len > 0))
    return c.json({ error: "bad part" }, 400);
  // Stream the chunk straight through with its known length (no buffering in Worker memory).
  const { readable, writable } = new FixedLengthStream(len);
  const pump = c.req.raw.body.pipeTo(writable);
  const uploaded = await c.env.CLIPS.resumeMultipartUpload(key, uploadId).uploadPart(part, readable);
  await pump;
  return c.json(uploaded);
});

ui.post("/uploads/complete", async (c) => {
  const { key, uploadId, parts } = await c.req.json<{ key: string; uploadId: string; parts: R2UploadedPart[] }>();
  if (!key.startsWith("sources/")) return c.json({ error: "bad key" }, 400);
  await c.env.CLIPS.resumeMultipartUpload(key, uploadId).complete(parts);
  return c.json({ ok: true });
});

ui.post("/uploads/abort", async (c) => {
  const { key, uploadId } = await c.req.json<{ key: string; uploadId: string }>();
  if (key.startsWith("sources/")) await c.env.CLIPS.resumeMultipartUpload(key, uploadId).abort();
  return c.json({ ok: true });
});

ui.get("/sources/:id", async (c) => {
  const id = c.req.param("id");
  const source = await db.getSource(c.env.DB, id);
  if (!source) return c.notFound();
  const { jobs, error: batchError } = await syncBatch(c.env, [source]);
  // syncBatch may have just marked it failed, so read clips/events after it.
  const [clips, events, posts, metrics] = await Promise.all([
    db.listClips(c.env.DB, { source: id }), db.sourceEvents(c.env.DB, id), latestPosts(c.env.DB), allMetrics(c.env.DB),
  ]);
  const active = ACTIVE_STAGES.has(source.stage);
  let job = source.batch_job_id ? (jobs.get(source.batch_job_id) ?? null) : null;
  if (!job && source.batch_job_id && !active) {
    // Finished sources aren't synced; look the job up once anyway so its logs stay viewable.
    job = (await describeJobs(c.env, [source.batch_job_id]).catch(() => null))?.get(source.batch_job_id) ?? null;
  }
  const stream = job?.container?.logStreamName;
  let lines: LogLine[] | null = null;
  let logError: string | undefined;
  if (stream) {
    try {
      lines = await logTail(c.env, stream, 200);
    } catch (err) {
      logError = err instanceof Error ? err.message : String(err);
    }
  }
  const p = progress(source, clips, events, job);
  return c.html(
    <Layout title={id} email={c.get("email")} nav="sources" refresh={active}>
      <a class="crumb" href="/sources">← Sources</a>
      <div class="page-head">
        <div style="min-width:0">
          <h1 class="row" style="gap:10px">{id} <Pill v={source.stage} /></h1>
          <p class="sub" style="margin:4px 0 0">
            {source.owner} · {source.permission === "cc_by" ? "CC BY" : source.permission === "granted" ? "permission granted" : "own"}
            {source.credit ? ` · credit “${source.credit}”` : ""}
            {source.duration ? ` · ${Math.round(source.duration / 60)} min` : ""}
          </p>
        </div>
        {/^https?:/.test(source.origin) ? <a class="btn sm" href={source.origin} target="_blank" rel="noopener">Original ↗</a> : null}
      </div>
      <ProgressPanel p={p} active={active} job={job} batchError={batchError} />
      {source.error ? <div class="err" style="margin-top:12px">{source.error}</div> : null}
      {source.stage === "failed" || source.stage === "partial" ? <RetryForm id={id} clips={clips.length || 5} /> : null}
      <h2>Clips <span class="muted" style="font-weight:400">{clips.length}</span></h2>
      <ClipGrid clips={clips} posts={posts} metrics={metrics} empty={active ? "Clips appear here as they finish rendering." : "No clips were produced."} />
      <details class="fold" open={active || source.stage === "failed" ? true : undefined}>
        <summary>Logs {active ? <span class="pill warn">live</span> : null}</summary>
        <div class="body"><LogPanel lines={lines} error={logError} stream={stream} /></div>
      </details>
      <details class="fold">
        <summary>Activity <span class="muted" style="font-weight:400">{events.length}</span></summary>
        <div class="body">
          <table>
            <tbody>
              {events.map((e) => (<tr><td class="muted" style="width:180px;white-space:nowrap">{e.created_at}</td><td>{e.message}</td></tr>))}
            </tbody>
          </table>
        </div>
      </details>
    </Layout>,
  );
});

// Re-run a failed or partial source on the GPU; cloud-run resumes from the work dir checkpointed in S3.
ui.post("/sources/:id/retry", async (c) => {
  const id = c.req.param("id");
  const source = await db.getSource(c.env.DB, id);
  if (!source) return c.notFound();
  if (ACTIVE_STAGES.has(source.stage)) return c.redirect(`/sources/${id}`, 303);
  const clips = Math.min(10, Math.max(1, Number((await c.req.parseBody()).clips) || 5));
  try {
    const jobId = await submitBatchJob(c.env, id, clips);
    await db.setSourceStage(c.env.DB, id, { stage: "queued", batch_job_id: jobId, error: null });
  } catch (err) {
    await db.setSourceStage(c.env.DB, id, { stage: "failed", error: `Could not start job: ${String(err)}` });
  }
  return c.redirect(`/sources/${id}`, 303);
});

async function renderClip(c: Context<AppEnv>, id: string, flash?: string) {
  const clip = await db.getClip(c.env.DB, id);
  if (!clip) return c.notFound();
  await advancePending(c.env, id, true).catch(() => {}); // the crons do this too; this just makes the page current
  const [source, posts, accounts, siblings, metricsMap] = await Promise.all([
    db.getSource(c.env.DB, clip.source_id), clipPosts(c.env.DB, id), accountNames(c.env),
    c.env.DB.prepare("SELECT id FROM clips WHERE source_id = ? ORDER BY id").bind(clip.source_id).all<{ id: string }>(),
    allMetrics(c.env.DB, id),
  ]);
  const metrics = metricsMap.get(id);
  const credit = source?.credit ?? null;
  // TikTok requires showing the creator's own name and privacy options before a direct post.
  let creator: tiktok.CreatorInfo | null = null;
  let creatorError: string | undefined;
  if (accounts.tiktok) {
    try {
      creator = await tiktok.creatorInfo(c.env);
    } catch (err) {
      creatorError = err instanceof Error ? err.message : String(err);
    }
  }
  const latest = { tiktok: posts.find((p) => p.platform === "tiktok"), instagram: posts.find((p) => p.platform === "instagram") };
  const states = platformStates(clip, latest);
  const ids = siblings.results.map((r) => r.id);
  const at = ids.indexOf(id);
  // Open on the details while it's unreviewed, else on the first platform it isn't on yet.
  const defaultTab = clip.review === "pending" ? "details"
    : (["youtube", "tiktok", "instagram"] as const).find((pf) => states[pf].state === "none" || states[pf].state === "failed") ?? "details";
  return c.html(
    <Layout title={clip.title ?? id} email={c.get("email")} nav="clips" refresh={posts.some((p) => p.status === "processing")}>
      <ClipPage
        clip={clip}
        credit={credit}
        flash={flash}
        states={states}
        metrics={metrics}
        nav={{ prev: ids[at - 1], next: ids[at + 1], index: at + 1, total: ids.length }}
        defaultTab={defaultTab}
        panels={{
          youtube: <YouTubePanel clip={clip} channel={accounts.youtube ?? null} credit={credit} stats={metrics?.youtube} />,
          tiktok: (
            <TikTokPanel clip={clip} account={accounts.tiktok} caption={captionFor("tiktok", clip, credit)}
              posts={posts.filter((p) => p.platform === "tiktok")} creator={creator} creatorError={creatorError} stats={metrics?.tiktok} />
          ),
          instagram: (
            <InstagramPanel clip={clip} account={accounts.instagram} caption={captionFor("instagram", clip, credit)}
              posts={posts.filter((p) => p.platform === "instagram")} stats={metrics?.instagram} />
          ),
        }}
      />
    </Layout>,
  );
}

const PLATFORMS: Platform[] = ["tiktok", "instagram"];
const isPlatform = (p: string): p is Platform => (PLATFORMS as string[]).includes(p);
const isAccount = (p: string): p is AccountPlatform => p === "youtube" || isPlatform(p);
const AUTH = { youtube, tiktok, instagram } as const;

// Save / reset a platform caption, or post the clip.
ui.post("/clips/:id/social/:platform", async (c) => {
  const id = c.req.param("id");
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) return c.notFound();
  const clip = await db.getClip(c.env.DB, id);
  if (!clip) return c.notFound();
  const f = await c.req.parseBody();
  const action = String(f.action ?? "");
  const typed = String(f.caption ?? "").replace(/\r\n/g, "\n").trim().slice(0, CAPTION_MAX);
  const saved = savedCaptions(clip);
  const back = (msg: string) => c.redirect(`/clips/${id}?flash=${encodeURIComponent(msg)}#${platform}`, 303);

  if (action === "reset") {
    delete saved[platform];
    await db.updateClip(c.env.DB, id, { captions: JSON.stringify(saved) });
    return back("Caption reset to auto");
  }
  const source = await db.getSource(c.env.DB, clip.source_id);
  const credit = source?.credit ?? null;
  // Only store it as the user's own caption if it differs from the auto one.
  const custom = typed && typed !== captionFor(platform, { ...clip, captions: "{}" }, credit).text;
  if (custom) saved[platform] = typed;
  else delete saved[platform];
  await db.updateClip(c.env.DB, id, { captions: JSON.stringify(saved) });
  if (action === "save") return back("Caption saved");
  if (action !== "post") return c.text("bad action", 400);
  if (!clip.video_key) return back("This clip isn't rendered yet");

  const caption = withCredit(typed || captionFor(platform, clip, credit).text, credit);
  let mode = "reel";
  let privacy: string | null = null;
  try {
    let remoteId: string;
    if (platform === "tiktok") {
      mode = f.mode === "draft" ? "draft" : "direct";
      privacy = mode === "direct" ? String(f.privacy ?? "") : null;
      if (mode === "direct" && !privacy) return back("Choose who can view the TikTok first");
      remoteId = await tiktok.post(c.env, clip.video_key, {
        mode: mode as "direct" | "draft", caption, privacy: privacy ?? "",
        allowComments: f.allow_comments === "1", allowDuet: f.allow_duet === "1", allowStitch: f.allow_stitch === "1",
      });
    } else {
      remoteId = await instagram.post(c.env, clip.video_key, caption, f.share_to_feed === "1");
    }
    await insertPost(c.env.DB, { clip_id: id, platform, mode, caption, privacy, remote_id: remoteId });
    return back(platform === "tiktok" ? "Uploaded to TikTok; processing" : "Sent to Instagram; processing (usually 1–3 min)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "social post failed", clip: id, platform, error: msg }));
    await insertPost(c.env.DB, { clip_id: id, platform, mode, caption, privacy, status: "failed", error: msg.slice(0, 1000) });
    return back(`${platform === "tiktok" ? "TikTok" : "Instagram"} post failed: ${msg.slice(0, 300)}`);
  }
});

// ── Metrics
ui.get("/metrics", async (c) => {
  const [clips, metrics] = await Promise.all([db.listClips(c.env.DB, {}), allMetrics(c.env.DB)]);
  return c.html(
    <Layout title="Metrics" email={c.get("email")} nav="metrics">
      <MetricsPage clips={clips} metrics={metrics} flash={c.req.query("flash")} />
    </Layout>,
  );
});

const refreshedMsg = (r: { updated: number; errors: string[] }) =>
  r.errors.length ? `Stats refreshed with errors: ${r.errors.join("; ").slice(0, 300)}` : `Stats refreshed (${r.updated} updated)`;

ui.post("/metrics/refresh", async (c) => {
  const r = await refreshMetrics(c.env);
  return c.redirect(`/metrics?flash=${encodeURIComponent(refreshedMsg(r))}`, 303);
});

ui.post("/clips/:id/metrics", async (c) => {
  const id = c.req.param("id");
  const r = await refreshMetrics(c.env, id);
  return c.redirect(`/clips/${id}?flash=${encodeURIComponent(refreshedMsg(r))}`, 303);
});

// ── Connected accounts (OAuth). The callback is also behind Access: the browser carries the login.
ui.get("/accounts", async (c) =>
  c.html(
    <Layout title="Accounts" email={c.get("email")} nav="accounts">
      <AccountsPage
        accounts={await accountNames(c.env)}
        configured={{
          youtube: !!(c.env.YT_CLIENT_ID && c.env.YT_CLIENT_SECRET && c.env.TOKEN_ENC_KEY),
          tiktok: !!(c.env.TIKTOK_CLIENT_KEY && c.env.TIKTOK_CLIENT_SECRET && c.env.TOKEN_ENC_KEY),
          instagram: !!(c.env.META_APP_ID && c.env.META_APP_SECRET && c.env.META_CONFIG_ID && c.env.TOKEN_ENC_KEY && c.env.R2_ACCESS_KEY_ID),
        }}
        flash={c.req.query("flash")}
      />
    </Layout>,
  ),
);

const redirectUri = (c: Context<AppEnv>, p: AccountPlatform) => `${new URL(c.req.url).origin}/oauth/${p}/callback`;

ui.get("/oauth/:platform/start", (c) => {
  const p = c.req.param("platform");
  if (!isAccount(p)) return c.notFound();
  const state = crypto.randomUUID();
  setCookie(c, `oauth_${p}`, state, { httpOnly: true, secure: true, sameSite: "Lax", path: "/oauth", maxAge: 600 });
  const url = AUTH[p].authorizeUrl(c.env, redirectUri(c, p), state);
  return c.redirect(url, 302);
});

ui.get("/oauth/:platform/callback", async (c) => {
  const p = c.req.param("platform");
  if (!isAccount(p)) return c.notFound();
  const back = (msg: string) => c.redirect(`/accounts?flash=${encodeURIComponent(msg)}`, 303);
  const expected = getCookie(c, `oauth_${p}`);
  deleteCookie(c, `oauth_${p}`, { path: "/oauth" });
  if (!expected || c.req.query("state") !== expected) return back("Login expired or was tampered with; try again");
  const code = c.req.query("code");
  if (!code) return back(`${p} login cancelled: ${c.req.query("error_description") ?? c.req.query("error") ?? "no code"}`);
  try {
    const acct = await AUTH[p].connect(c.env, code, redirectUri(c, p));
    return back(`Connected ${p} as ${acct.accountName ?? acct.accountId}`);
  } catch (err) {
    return back(`Couldn't connect: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ui.post("/accounts/:platform/disconnect", async (c) => {
  const p = c.req.param("platform");
  if (!isAccount(p)) return c.notFound();
  await deleteAccount(c.env, p);
  return c.redirect("/accounts?flash=Disconnected", 303);
});

ui.get("/clips/:id", (c) => renderClip(c, c.req.param("id"), c.req.query("flash")));

ui.post("/clips/:id", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const review = String(form.review ?? "pending");
  await db.updateClip(c.env.DB, id, {
    title: String(form.title ?? "").slice(0, 100),
    description: String(form.description ?? ""),
    tags: String(form.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    review: ["pending", "approved", "rejected"].includes(review) ? review : "pending",
  });
  return c.redirect(`/clips/${id}?flash=Saved#details`, 303);
});

ui.post("/clips/:id/youtube", async (c) => {
  const id = c.req.param("id");
  const clip = await db.getClip(c.env.DB, id);
  if (!clip) return c.notFound();
  if (clip.youtube_id) return c.redirect(`/clips/${id}`, 303);
  const form = await c.req.parseBody();
  const privacy = (["private", "unlisted", "public"] as const).find((p) => p === form.privacy) ?? "private";
  const source = await db.getSource(c.env.DB, clip.source_id);
  try {
    const videoId = await uploadToYouTube(c.env, clip, source?.credit ?? null, privacy);
    await db.updateClip(c.env.DB, id, { youtube_id: videoId, stage: "uploaded", review: "approved" });
    return c.redirect(`/clips/${id}?flash=${encodeURIComponent(`Uploaded to YouTube (${privacy})`)}#youtube`, 303);
  } catch (err) {
    console.error(JSON.stringify({ msg: "youtube upload failed", clip: id, error: String(err) }));
    return renderClip(c, id, `YouTube upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Clip media from R2, with Range support so <video> can seek.
ui.get("/media/*", async (c) => {
  const key = decodeURIComponent(c.req.path.slice("/media/".length));
  if (!key.startsWith("clips/") || key.includes("..")) return c.notFound();
  const obj = await c.env.CLIPS.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (obj === null) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  if (c.req.query("download")) headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  if (!("body" in obj)) return new Response(null, { status: 304, headers }); // onlyIf precondition failed
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && c.req.header("range")) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
});

app.route("/", ui);

export default {
  fetch: app.fetch,
  // Every minute: finish TikTok/Instagram posts still processing.
  // Hourly: also notice TikTok drafts that were posted from the app, then refresh metrics.
  async scheduled(event, env, ctx) {
    if (event.cron === "5 * * * *") ctx.waitUntil(advancePending(env, undefined, true).then(() => refreshMetrics(env)).then(() => undefined));
    else ctx.waitUntil(advancePending(env));
  },
} satisfies ExportedHandler<Env>;
