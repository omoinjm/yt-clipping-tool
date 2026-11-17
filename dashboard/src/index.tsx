import { Hono, type Context } from "hono";
import { requireAccess, requireToken, type AppEnv } from "./auth";
import * as db from "./db";
import { ClipGrid, ClipPage, ClipToolbar, platformStates, type ClipFilter } from "./views/Clips";
import { ACTIVE_STAGES, Layout, Pill } from "./views/Layout";
import { NewSourceForm } from "./views/NewSource";
import { SourceList } from "./views/Sources";
import { slugify, sourceKeyFor, validate, type NewSource, type Permission } from "./sources";
import { describeJobs, logTail, submitBatchJob, type LogLine } from "./aws";
import { progress, syncBatch } from "./progress";
import { LogPanel, ProgressPanel, RetryForm } from "./views/Progress";
import * as youtube from "./youtube";
import { allMetrics, refreshMetrics } from "./social/metrics";
import { MetricsPage } from "./views/Metrics";
import pub from "./public";
import { cleanupAbandoned, getSubmission, getUploadToken, listSubmissions, setSubmission, setUploadToken } from "./submissions";
import { SubmissionsPage } from "./views/Submissions";
import { accessConfigured, addUser, listUsers, removeUser } from "./access";
import { UsersPage } from "./views/Users";
import { uploadToYouTube } from "./youtube";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { captionFor, savedCaptions, withCredit, CAPTION_MAX } from "./social/captions";
import * as instagram from "./social/instagram";
import { advancePending, clipPosts, insertPost, latestPosts } from "./social/posts";
import * as tiktok from "./social/tiktok";
import { accountNames, allAccountNames, deleteAccount, type AccountPlatform, type Platform } from "./social/tokens";
import {
  assignClip, CHANNEL_ID_RE, clipLocked, currentScope, deleteChannel, getChannel, inScope, listChannels, saveChannel, SCOPE_COOKIE,
} from "./channels";
import { ChannelsPage } from "./views/Channels";
import { InstagramPanel, TikTokPanel, YouTubePanel } from "./views/Social";

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

// ───────────── Public upload link (NOT behind Access: needs an Access Bypass policy for /u) ─────────────
app.route("/u", pub);

// ───────────── UI (behind Cloudflare Access) ─────────────
const ui = new Hono<AppEnv>();
ui.use("*", requireAccess);
// Header channel switcher: every page gets the channel list and the current scope.
ui.use("*", async (c, next) => {
  c.set("channels", await listChannels(c.env.DB));
  c.set("scope", currentScope(c));
  return next();
});

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
  const scope = c.get("scope");
  const scoped = all.filter((cl) => inScope(scope, cl));
  let clips = f.notOn ? scoped.filter((cl) => platformStates(cl, posts.get(cl.id))[f.notOn as "youtube"].state !== "live" &&
    platformStates(cl, posts.get(cl.id))[f.notOn as "youtube"].state !== "drafted") : scoped;
  if (f.sort === "score") clips = [...clips].sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  return c.html(
    <Layout title="Clips" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="clips">
      <div class="page-head">
        <div>
          <h1>Clips</h1>
          <p class="sub" style="margin:4px 0 0">Review, edit and publish. Hover a card to preview it.</p>
        </div>
        <a class="btn primary" href="/sources/new">+ New source</a>
      </div>
      <ClipToolbar f={f} sources={sources.filter((x) => (x.clip_count ?? 0) > 0).map((x) => x.id)} count={clips.length} />
      <ClipGrid clips={clips} posts={posts} metrics={metrics} channels={c.get("channels")} showChannel={scope === ""}
        empty={scoped.length ? "No clips match these filters." : scope === "none" ? "No unassigned clips." : scope ? "No clips in this channel yet. Assign finished clips to it from their page." : undefined} />
    </Layout>,
  );
});

ui.get("/sources", async (c) => {
  const sources = await db.listSources(c.env.DB);
  const { jobs } = await syncBatch(c.env, sources); // also marks jobs that died silently as failed
  return c.html(
    <Layout title="Sources" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="sources" refresh={sources.some((s) => ACTIVE_STAGES.has(s.stage))}>
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
  c.html(<Layout title="New source" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="new"><NewSourceForm /></Layout>),
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
      <Layout title="New source" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="new"><NewSourceForm values={input} errors={errors} /></Layout>,
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
    <Layout title={id} email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="sources" refresh={active}>
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
  const [source, posts, accounts, siblings, metricsMap, channel, locked] = await Promise.all([
    db.getSource(c.env.DB, clip.source_id), clipPosts(c.env.DB, id), accountNames(c.env, clip.channel_id),
    c.env.DB.prepare("SELECT id FROM clips WHERE source_id = ? ORDER BY id").bind(clip.source_id).all<{ id: string }>(),
    allMetrics(c.env.DB, id),
    clip.channel_id ? getChannel(c.env.DB, clip.channel_id) : Promise.resolve(null),
    clipLocked(c.env.DB, clip),
  ]);
  const metrics = metricsMap.get(id);
  const tags = channel?.hashtags ?? "";
  const credit = source?.credit ?? null;
  // TikTok requires showing the creator's own name and privacy options before a direct post.
  let creator: tiktok.CreatorInfo | null = null;
  let creatorError: string | undefined;
  if (accounts.tiktok) {
    try {
      creator = await tiktok.creatorInfo(c.env, clip.channel_id!);
    } catch (err) {
      creatorError = err instanceof Error ? err.message : String(err);
    }
  }
  const latest = { tiktok: posts.find((p) => p.platform === "tiktok"), instagram: posts.find((p) => p.platform === "instagram") };
  const states = platformStates(clip, latest);
  const ids = siblings.results.map((r) => r.id);
  const at = ids.indexOf(id);
  // Open on the details while it's unreviewed, else on the first platform it isn't on yet.
  const defaultTab = clip.review === "pending" || !clip.channel_id ? "details"
    : (["youtube", "tiktok", "instagram"] as const).find((pf) => states[pf].state === "none" || states[pf].state === "failed") ?? "details";
  return c.html(
    <Layout title={clip.title ?? id} email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="clips" refresh={posts.some((p) => p.status === "processing")}>
      <ClipPage
        clip={clip}
        credit={credit}
        flash={flash}
        states={states}
        metrics={metrics}
        channel={{ current: channel, all: c.get("channels"), locked }}
        nav={{ prev: ids[at - 1], next: ids[at + 1], index: at + 1, total: ids.length }}
        defaultTab={defaultTab}
        panels={{
          youtube: <YouTubePanel clip={clip} channel={accounts.youtube ?? null} credit={credit} stats={metrics?.youtube} assigned={!!channel} />,
          tiktok: (
            <TikTokPanel clip={clip} account={accounts.tiktok} caption={captionFor("tiktok", clip, credit, tags)} assigned={!!channel}
              posts={posts.filter((p) => p.platform === "tiktok")} creator={creator} creatorError={creatorError} stats={metrics?.tiktok} />
          ),
          instagram: (
            <InstagramPanel clip={clip} account={accounts.instagram} caption={captionFor("instagram", clip, credit, tags)} assigned={!!channel}
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
  const [source, channel] = await Promise.all([
    db.getSource(c.env.DB, clip.source_id),
    clip.channel_id ? getChannel(c.env.DB, clip.channel_id) : Promise.resolve(null),
  ]);
  const credit = source?.credit ?? null;
  const tags = channel?.hashtags ?? "";
  // Only store it as the user's own caption if it differs from the auto one.
  const custom = typed && typed !== captionFor(platform, { ...clip, captions: "{}" }, credit, tags).text;
  if (custom) saved[platform] = typed;
  else delete saved[platform];
  await db.updateClip(c.env.DB, id, { captions: JSON.stringify(saved) });
  if (action === "save") return back("Caption saved");
  if (action !== "post") return c.text("bad action", 400);
  if (!clip.video_key) return back("This clip isn't rendered yet");
  if (!channel) return back("Assign this clip to a channel before posting it");
  const ch = channel.id;

  const caption = withCredit(typed || captionFor(platform, clip, credit, tags).text, credit);
  let mode = "reel";
  let privacy: string | null = null;
  try {
    let remoteId: string;
    if (platform === "tiktok") {
      mode = f.mode === "draft" ? "draft" : "direct";
      privacy = mode === "direct" ? String(f.privacy ?? "") : null;
      if (mode === "direct" && !privacy) return back("Choose who can view the TikTok first");
      remoteId = await tiktok.post(c.env, ch, clip.video_key, {
        mode: mode as "direct" | "draft", caption, privacy: privacy ?? "",
        allowComments: f.allow_comments === "1", allowDuet: f.allow_duet === "1", allowStitch: f.allow_stitch === "1",
      });
    } else {
      remoteId = await instagram.post(c.env, ch, clip.video_key, caption, f.share_to_feed === "1");
    }
    await insertPost(c.env.DB, { clip_id: id, channel_id: ch, platform, mode, caption, privacy, remote_id: remoteId });
    return back(platform === "tiktok" ? "Uploaded to TikTok; processing" : "Sent to Instagram; processing (usually 1–3 min)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "social post failed", clip: id, platform, error: msg }));
    await insertPost(c.env.DB, { clip_id: id, channel_id: ch, platform, mode, caption, privacy, status: "failed", error: msg.slice(0, 1000) });
    return back(`${platform === "tiktok" ? "TikTok" : "Instagram"} post failed: ${msg.slice(0, 300)}`);
  }
});

// ── Public upload submissions
ui.get("/submissions", async (c) => {
  const [token, subs] = await Promise.all([getUploadToken(c.env.DB), listSubmissions(c.env.DB)]);
  return c.html(
    <Layout title="Submissions" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="submissions">
      <SubmissionsPage link={token ? `${new URL(c.req.url).origin}/u/${token}` : null}
        turnstile={!!(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY)} subs={subs} flash={c.req.query("flash")} />
    </Layout>,
  );
});

ui.post("/submissions/link", async (c) => {
  const action = String((await c.req.parseBody()).action ?? "");
  const token = await setUploadToken(c.env.DB, action === "rotate");
  return c.redirect(`/submissions?flash=${encodeURIComponent(token ? "New upload link created; the old one no longer works" : "Upload link turned off")}`, 303);
});

ui.post("/submissions/:id/accept", async (c) => {
  const sub = await getSubmission(c.env.DB, c.req.param("id"));
  if (!sub || sub.status !== "received") return c.redirect("/submissions?flash=That+upload+isn%27t+waiting+for+review", 303);
  const f = await c.req.parseBody();
  const id = String(f.source_id ?? "").trim().toLowerCase();
  const clips = Math.min(10, Math.max(1, Number(f.clips) || 5));
  const back = (m: string) => c.redirect(`/submissions?flash=${encodeURIComponent(m)}`, 303);
  if (!sourceKeyFor(id, "x.mp4")) return back("Source ID: 2–41 chars, lowercase letters, digits, - or _");
  if (await db.getSource(c.env.DB, id)) return back(`Source ID “${id}” is already used`);
  // The uploader's details + rights confirmation are the permission record; the job re-checks it.
  await db.upsertSource(c.env.DB, id, {
    origin: `r2://${c.env.R2_BUCKET_NAME}/${sub.r2_key}`,
    owner: sub.name,
    permission: "granted",
    proof: `Public upload ${sub.id} by ${sub.name} <${sub.email}> on ${sub.created_at} UTC; uploader confirmed they own the rights and allowed clipping and publishing with credit.`,
    credit: sub.credit || sub.name,
    stage: "queued",
    error: null,
  });
  await setSubmission(c.env.DB, sub.id, { status: "accepted", source_id: id });
  try {
    const jobId = await submitBatchJob(c.env, id, clips);
    await db.setSourceStage(c.env.DB, id, { stage: "queued", batch_job_id: jobId });
  } catch (err) {
    await db.setSourceStage(c.env.DB, id, { stage: "failed", error: `Could not start job: ${String(err)}` });
  }
  return c.redirect(`/sources/${id}`, 303);
});

ui.post("/submissions/:id/reject", async (c) => {
  const sub = await getSubmission(c.env.DB, c.req.param("id"));
  if (sub && sub.status === "received") {
    await c.env.CLIPS.delete(sub.r2_key);
    await setSubmission(c.env.DB, sub.id, { status: "rejected" });
  }
  return c.redirect("/submissions?flash=Upload+rejected+and+deleted", 303);
});

// ── Dashboard users (Cloudflare Access group)
ui.get("/users", async (c) => {
  const configured = accessConfigured(c.env);
  let users: string[] | null = null;
  let error: string | undefined;
  if (configured) {
    try {
      users = await listUsers(c.env);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return c.html(
    <Layout title="Users" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="users">
      <UsersPage me={c.get("email")} users={users} error={error} configured={configured} flash={c.req.query("flash")} />
    </Layout>,
  );
});

ui.post("/users/add", async (c) => {
  const email = String((await c.req.parseBody()).email ?? "").trim().toLowerCase();
  const back = (m: string) => c.redirect(`/users?flash=${encodeURIComponent(m)}`, 303);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back("Enter a valid email address");
  try {
    await addUser(c.env, email);
    return back(`Added ${email}. They can sign in now.`);
  } catch (err) {
    return back(`Couldn't add user: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ui.post("/users/remove", async (c) => {
  const email = String((await c.req.parseBody()).email ?? "").trim();
  const back = (m: string) => c.redirect(`/users?flash=${encodeURIComponent(m)}`, 303);
  if (!email || email.toLowerCase() === c.get("email").toLowerCase()) return back("You can't remove yourself");
  try {
    await removeUser(c.env, email);
    return back(`Removed ${email} and signed them out`);
  } catch (err) {
    return back(`Couldn't remove user: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ── Metrics
ui.get("/metrics", async (c) => {
  const scope = c.get("scope");
  const [all, metrics] = await Promise.all([db.listClips(c.env.DB, {}), allMetrics(c.env.DB)]);
  const clips = all.filter((cl) => inScope(scope, cl));
  for (const id of [...metrics.keys()]) if (!clips.some((cl) => cl.id === id)) metrics.delete(id);
  return c.html(
    <Layout title="Metrics" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="metrics">
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

// ── Channels: niche brands, each with its own connected accounts. (OAuth callbacks are behind Access too.)
ui.get("/accounts", (c) => c.redirect("/channels", 301));

ui.get("/channels", async (c) =>
  c.html(
    <Layout title="Channels" email={c.get("email")} channels={c.get("channels")} scope={c.get("scope")} nav="channels">
      <ChannelsPage
        channels={c.get("channels")}
        accounts={await allAccountNames(c.env)}
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

const channelBack = (c: Context<AppEnv>, msg: string, anchor = "") =>
  c.redirect(`/channels?flash=${encodeURIComponent(msg)}${anchor ? `#ch-${anchor}` : ""}`, 303);

ui.post("/channels", async (c) => {
  const f = await c.req.parseBody();
  const name = String(f.name ?? "").trim().slice(0, 60);
  const id = slugify(String(f.id ?? "") || name).slice(0, 40);
  if (!name) return channelBack(c, "Give the channel a name");
  if (!CHANNEL_ID_RE.test(id)) return channelBack(c, "Channel ID: 2–41 lowercase letters, digits or -");
  if (await getChannel(c.env.DB, id)) return channelBack(c, `A channel with ID “${id}” already exists`);
  await saveChannel(c.env.DB, { id, name, niche: String(f.niche ?? "").trim().slice(0, 120), hashtags: String(f.hashtags ?? "") }, true);
  return channelBack(c, `Channel “${name}” created. Connect its accounts below.`, id);
});

ui.post("/channels/:id", async (c) => {
  const ch = await getChannel(c.env.DB, c.req.param("id"));
  if (!ch) return c.notFound();
  const f = await c.req.parseBody();
  const name = String(f.name ?? "").trim().slice(0, 60) || ch.name;
  await saveChannel(c.env.DB, { id: ch.id, name, niche: String(f.niche ?? "").trim().slice(0, 120), hashtags: String(f.hashtags ?? "") }, false);
  return channelBack(c, `Saved “${name}”`, ch.id);
});

ui.post("/channels/:id/delete", async (c) => {
  const ch = await getChannel(c.env.DB, c.req.param("id"));
  if (!ch) return c.notFound();
  const blocked = await deleteChannel(c.env.DB, ch.id);
  if (blocked) return channelBack(c, `Can't delete “${ch.name}”: ${blocked}`, ch.id);
  if (c.get("scope") === ch.id) setCookie(c, SCOPE_COOKIE, "", { path: "/", maxAge: 0 });
  return channelBack(c, `Deleted “${ch.name}”; its clips are unassigned again`);
});

ui.post("/channels/:id/disconnect/:platform", async (c) => {
  const p = c.req.param("platform");
  const ch = await getChannel(c.env.DB, c.req.param("id"));
  if (!isAccount(p) || !ch) return c.notFound();
  await deleteAccount(c.env, ch.id, p);
  return channelBack(c, `Disconnected ${p} from “${ch.name}”`, ch.id);
});

// Header switcher: remember which channel to show, then go back where you were.
ui.post("/scope", async (c) => {
  const f = await c.req.parseBody();
  const v = String(f.scope ?? "");
  setCookie(c, SCOPE_COOKIE, v === "none" || CHANNEL_ID_RE.test(v) ? v : "", { path: "/", sameSite: "Lax", secure: true, httpOnly: true, maxAge: 31536000 });
  const to = String(f.to ?? "");
  if (/^\/(?!\/)/.test(to)) return c.redirect(to, 303); // same-site path only
  const ref = c.req.header("referer");
  const back = ref && new URL(ref).origin === new URL(c.req.url).origin ? new URL(ref).pathname + new URL(ref).search : "/";
  return c.redirect(back.startsWith("/clips/") ? "/" : back, 303);
});

// Assign a finished clip to a channel (locked once it has gone out anywhere).
ui.post("/clips/:id/channel", async (c) => {
  const clip = await db.getClip(c.env.DB, c.req.param("id"));
  if (!clip) return c.notFound();
  const back = (m: string) => c.redirect(`/clips/${clip.id}?flash=${encodeURIComponent(m)}#details`, 303);
  if (await clipLocked(c.env.DB, clip)) return back("This clip has already gone out on its channel, so it can't be moved");
  const v = String((await c.req.parseBody()).channel_id ?? "");
  if (!v) {
    await assignClip(c.env.DB, clip.id, null);
    return back("Clip unassigned");
  }
  const ch = await getChannel(c.env.DB, v);
  if (!ch) return back("That channel doesn't exist");
  await assignClip(c.env.DB, clip.id, ch.id);
  return back(`Assigned to ${ch.name}`);
});

const redirectUri = (c: Context<AppEnv>, p: AccountPlatform) => `${new URL(c.req.url).origin}/oauth/${p}/callback`;

// Connect an account to a channel: /oauth/<platform>/start?channel=<id>. The channel rides in the state cookie.
ui.get("/oauth/:platform/start", async (c) => {
  const p = c.req.param("platform");
  if (!isAccount(p)) return c.notFound();
  const ch = await getChannel(c.env.DB, c.req.query("channel") ?? "");
  if (!ch) return channelBack(c, "Pick a channel to connect the account to");
  const state = crypto.randomUUID();
  setCookie(c, `oauth_${p}`, `${state}.${ch.id}`, { httpOnly: true, secure: true, sameSite: "Lax", path: "/oauth", maxAge: 600 });
  const url = AUTH[p].authorizeUrl(c.env, redirectUri(c, p), state);
  return c.redirect(url, 302);
});

ui.get("/oauth/:platform/callback", async (c) => {
  const p = c.req.param("platform");
  if (!isAccount(p)) return c.notFound();
  const [expected, chId] = (getCookie(c, `oauth_${p}`) ?? "").split(".");
  deleteCookie(c, `oauth_${p}`, { path: "/oauth" });
  const back = (msg: string) => channelBack(c, msg, chId);
  const ch = chId ? await getChannel(c.env.DB, chId) : null;
  if (!expected || !ch || c.req.query("state") !== expected) return back("Login expired or was tampered with; try again");
  const code = c.req.query("code");
  if (!code) return back(`${p} login cancelled: ${c.req.query("error_description") ?? c.req.query("error") ?? "no code"}`);
  try {
    const acct = await AUTH[p].connect(c.env, ch.id, code, redirectUri(c, p));
    return back(`Connected ${p} for “${ch.name}” as ${acct.accountName ?? acct.accountId}`);
  } catch (err) {
    return back(`Couldn't connect: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  if (!clip.channel_id) return c.redirect(`/clips/${id}?flash=${encodeURIComponent("Assign this clip to a channel before uploading it")}#details`, 303);
  const form = await c.req.parseBody();
  const privacy = (["private", "unlisted", "public"] as const).find((p) => p === form.privacy) ?? "private";
  const source = await db.getSource(c.env.DB, clip.source_id);
  try {
    const videoId = await uploadToYouTube(c.env, clip.channel_id, clip, source?.credit ?? null, privacy);
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
  if (!(key.startsWith("clips/") || key.startsWith("submissions/")) || key.includes("..")) return c.notFound();
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
    if (event.cron === "5 * * * *")
      ctx.waitUntil(Promise.all([
        advancePending(env, undefined, true).then(() => refreshMetrics(env)),
        cleanupAbandoned(env),
      ]).then(() => undefined));
    else ctx.waitUntil(advancePending(env));
  },
} satisfies ExportedHandler<Env>;
