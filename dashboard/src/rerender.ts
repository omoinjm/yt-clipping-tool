/**
 * Re-render a finished clip with a new header (style and/or text) on the CPU render job.
 * The job gets one presigned link to a spec in R2; outputs go to new versioned keys, so the current
 * video stays until the new one succeeds. The every-minute cron finishes jobs (swap keys, clean up).
 */
import { describeJobs, logTail, RENDER_LOG_GROUP, submitRenderJob } from "./aws";
import type { ClipRow } from "./db";
import type { ResolvedHeader } from "./headers";
import { presign } from "./r2";

export type RenderJobRow = {
  id: number; clip_id: string; batch_job_id: string | null; status: "running" | "done" | "failed";
  video_key: string; thumb_key: string; style_hash: string; hook: string | null; error: string | null;
  created_at: string; updated_at: string;
};

export function latestRenderJob(db: D1Database, clipId: string) {
  return db.prepare("SELECT * FROM render_jobs WHERE clip_id = ? ORDER BY id DESC LIMIT 1").bind(clipId).first<RenderJobRow>();
}

/** Can this clip be re-rendered on the CPU job (inputs were saved when it was first rendered)? */
export async function canRerender(env: Env, clip: ClipRow): Promise<boolean> {
  return !!clip.render_key && !!(await env.CLIPS.head(`${clip.render_key}vertical.mp4`));
}

export async function startRerender(env: Env, clip: ClipRow, h: ResolvedHeader): Promise<void> {
  if (!clip.render_key) throw new Error("This clip was rendered before re-renders existed; retry its source on the GPU instead");
  const running = await env.DB.prepare("SELECT 1 FROM render_jobs WHERE clip_id = ? AND status = 'running'").bind(clip.id).first();
  if (running) throw new Error("A re-render is already running for this clip");
  const n = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM render_jobs WHERE clip_id = ?").bind(clip.id).first<{ n: number }>())?.n ?? 0) + 1;
  const base = `clips/${clip.source_id}/${clip.id}-r${n}`;
  const out = { video: `${base}.mp4`, thumb: `${base}.jpg` };
  const spec = {
    clipId: clip.id,
    hook: clip.hook ?? "",
    header: h.style,
    inputs: {
      video: await presign(env, `${clip.render_key}vertical.mp4`, "GET", 7200),
      props: await presign(env, `${clip.render_key}props.json`, "GET", 7200),
    },
    outputs: { video: await presign(env, out.video, "PUT", 7200), thumb: await presign(env, out.thumb, "PUT", 7200) },
  };
  const specKey = `${clip.render_key}spec-r${n}.json`;
  await env.CLIPS.put(specKey, JSON.stringify(spec), { httpMetadata: { contentType: "application/json" } });
  const jobId = await submitRenderJob(env, clip.id, await presign(env, specKey, "GET", 7200));
  await env.DB.prepare(
    "INSERT INTO render_jobs (clip_id, batch_job_id, video_key, thumb_key, style_hash, hook) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(clip.id, jobId, out.video, out.thumb, h.hash, clip.hook ?? "").run();
}

/** Every minute: finish re-renders. Success swaps the clip's video/thumb to the new files and deletes the old ones. */
export async function advanceRenderJobs(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT * FROM render_jobs WHERE status = 'running' LIMIT 20").all<RenderJobRow>();
  if (!results.length) return;
  const jobs = await describeJobs(env, results.map((r) => r.batch_job_id!).filter(Boolean));
  for (const r of results) {
    const job = r.batch_job_id ? jobs.get(r.batch_job_id) : undefined;
    const done = (status: "done" | "failed", error: string | null = null) =>
      env.DB.prepare("UPDATE render_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?").bind(status, error, r.id).run();
    if (!job || job.status === "SUCCEEDED") {
      if (!job) continue;
      const head = await env.CLIPS.head(r.video_key);
      if (!head) {
        await done("failed", "The job finished but the new video wasn't uploaded");
        continue;
      }
      const clip = await env.DB.prepare("SELECT video_key, thumb_key, render_key FROM clips WHERE id = ?").bind(r.clip_id)
        .first<{ video_key: string | null; thumb_key: string | null; render_key: string | null }>();
      await env.DB.prepare(
        "UPDATE clips SET video_key = ?, thumb_key = ?, rendered_style = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(r.video_key, r.thumb_key, r.style_hash, r.clip_id).run();
      const old = [clip?.video_key, clip?.thumb_key].filter((k): k is string => !!k && k !== r.video_key && k !== r.thumb_key);
      if (old.length) await env.CLIPS.delete(old);
      await done("done");
    } else if (job.status === "FAILED") {
      let tail = "";
      if (job.container?.logStreamName) {
        try {
          tail = (await logTail(env, job.container.logStreamName, 8, RENDER_LOG_GROUP)).map((l) => l.message).join("\n");
        } catch {
          /* best effort */
        }
      }
      await done("failed", `${job.statusReason ?? "failed"}${tail ? `\n${tail}` : ""}`.slice(0, 1500));
    }
  }
}
