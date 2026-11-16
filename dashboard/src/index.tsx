import { Hono, type Context } from "hono";
import { requireAccess, requireToken, type AppEnv } from "./auth";
import * as db from "./db";
import { ClipDetail, ClipGrid } from "./views/Clips";
import { ACTIVE_STAGES, Layout, Pill } from "./views/Layout";
import { NewSourceForm } from "./views/NewSource";
import { SourceTable } from "./views/Sources";
import { sourceKeyFor, submitBatchJob, validate, type NewSource, type Permission } from "./sources";
import { uploadToYouTube } from "./youtube";

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
  const review = c.req.query("review");
  const clips = await db.listClips(c.env.DB, { review: review || undefined });
  const filter = (v: string, label: string) => (
    <a class={`btn ${(review ?? "") === v ? "on" : ""}`} href={v ? `/?review=${v}` : "/"}>{label}</a>
  );
  return c.html(
    <Layout title="Clips" email={c.get("email")}>
      <h1>Clips</h1>
      <div class="filters">
        {filter("", "All")}{filter("pending", "To review")}{filter("approved", "Approved")}{filter("rejected", "Rejected")}
      </div>
      <ClipGrid clips={clips} />
    </Layout>,
  );
});

ui.get("/sources", async (c) => {
  const sources = await db.listSources(c.env.DB);
  return c.html(
    <Layout title="Sources" email={c.get("email")} refresh={sources.some((s) => ACTIVE_STAGES.has(s.stage))}>
      <h1 class="row" style="justify-content:space-between">Sources <a class="btn primary" href="/sources/new" style="background:var(--accent);color:#111">+ New source</a></h1>
      <SourceTable sources={sources} />
    </Layout>,
  );
});

// ── New source: form, chunked upload to R2, then queue the GPU job.
ui.get("/sources/new", (c) =>
  c.html(<Layout title="New source" email={c.get("email")}><NewSourceForm /></Layout>),
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
      <Layout title="New source" email={c.get("email")}><NewSourceForm values={input} errors={errors} /></Layout>,
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
  const [source, clips, events] = await Promise.all([
    db.getSource(c.env.DB, id), db.listClips(c.env.DB, { source: id }), db.sourceEvents(c.env.DB, id),
  ]);
  if (!source) return c.notFound();
  return c.html(
    <Layout title={id} email={c.get("email")} refresh={ACTIVE_STAGES.has(source.stage)}>
      <p class="muted"><a href="/sources">← Sources</a></p>
      <h1 class="row">{id} <Pill v={source.stage} /></h1>
      <p class="muted">
        {source.owner} · {source.permission}{source.credit ? ` · credit ${source.credit}` : ""}
        {source.duration ? ` · ${Math.round(source.duration / 60)} min` : ""}
        {source.batch_job_id ? ` · Batch job ${source.batch_job_id}` : ""}
      </p>
      {source.error ? <div class="err">{source.error}</div> : null}
      <h2>Clips</h2>
      <ClipGrid clips={clips} />
      <h2>Activity</h2>
      <table>
        <tbody>
          {events.map((e) => (<tr><td class="muted" style="width:190px">{e.created_at}</td><td>{e.message}</td></tr>))}
        </tbody>
      </table>
    </Layout>,
  );
});

async function renderClip(c: Context<AppEnv>, id: string, flash?: string) {
  const clip = await db.getClip(c.env.DB, id);
  if (!clip) return c.notFound();
  const source = await db.getSource(c.env.DB, clip.source_id);
  return c.html(
    <Layout title={clip.title ?? id} email={c.get("email")}>
      <ClipDetail clip={clip} credit={source?.credit ?? null} flash={flash} />
    </Layout>,
  );
}

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
  return c.redirect(`/clips/${id}?flash=Saved`, 303);
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
    return c.redirect(`/clips/${id}?flash=${encodeURIComponent(`Uploaded to YouTube (${privacy})`)}`, 303);
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

export default app;
