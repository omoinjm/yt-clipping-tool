import { describeJobs, logTail, type BatchJob } from "./aws";
import * as db from "./db";
import type { ClipRow, SourceRow } from "./db";

export const ACTIVE_STAGES = new Set(["queued", "running", "ingested", "transcribed", "scenes", "selected", "producing"]);
const CLIP_DONE = new Set(["rendered", "published", "uploaded", "failed"]);

/** D1 `datetime('now')` text (UTC, no zone) → epoch ms. */
export const d1Time = (s: string) => Date.parse(s.replace(" ", "T") + "Z");

/**
 * The work that runs *after* each recorded stage, with rough GPU (g5/g4dn) timings.
 * `D` = source length in seconds, `n` = clip count. Rough by design: refined from observed
 * per-clip times once rendering starts.
 */
export const STEPS: { after: string; label: string; est: (D: number, n: number) => number }[] = [
  { after: "queued", label: "Start GPU machine", est: () => 8 * 60 },
  { after: "running", label: "Download + normalize", est: (D) => 60 + D * 0.3 },
  { after: "ingested", label: "Transcribe (WhisperX)", est: (D) => 60 + D / 30 },
  { after: "transcribed", label: "Detect scenes", est: (D) => 10 + D / 15 },
  { after: "scenes", label: "Pick clips (Claude)", est: () => 60 },
  { after: "selected", label: "Render clips", est: (_D, n) => n * 120 },
];
const STEP_INDEX: Record<string, number> = { ...Object.fromEntries(STEPS.map((s, i) => [s.after, i])), producing: 5 };
const DEFAULT_CLIPS = 5;

export type StepView = { label: string; state: "done" | "active" | "todo" | "failed"; took?: number };
export type Progress = {
  steps: StepView[];
  elapsed: number; // seconds since the job was queued
  eta: number | null; // seconds remaining, null when it can't be estimated yet
  note?: string; // what is happening right now
  clipsDone?: number;
  clipsTotal?: number;
};

type Event = { message: string; created_at: string };

export function progress(source: SourceRow, clips: ClipRow[], events: Event[], job: BatchJob | null, now = Date.now()): Progress {
  // Latest time each stage was entered (events are newest first; a resubmit starts the timeline over).
  const entered = new Map<string, number>();
  for (const e of [...events].reverse()) {
    const m = /^stage → (\w+)/.exec(e.message);
    if (!m) continue;
    if (m[1] === "queued") entered.clear();
    entered.set(m[1], d1Time(e.created_at));
  }
  const queuedAt = entered.get("queued") ?? job?.createdAt ?? d1Time(source.created_at);
  const current = STEP_INDEX[source.stage] ?? -1;
  const stepStart = entered.get(source.stage) ?? d1Time(source.updated_at);
  const D = source.duration ?? 0;
  const n = clips.length || DEFAULT_CLIPS;
  const clipsDone = clips.filter((c) => CLIP_DONE.has(c.stage)).length;

  const failed = source.stage === "failed";
  let failMarked = false;
  const steps: StepView[] = STEPS.map((s, i) => {
    const start = entered.get(s.after);
    const end = i + 1 < STEPS.length ? entered.get(STEPS[i + 1].after) : (entered.get("done") ?? entered.get("partial"));
    const finished = end !== undefined || (current === -1 && !failed) || (current > i);
    let state: StepView["state"] = finished ? "done" : i === current ? "active" : "todo";
    if (failed && !finished && !failMarked) ((state = "failed"), (failMarked = true));
    return { label: s.label, state, took: finished && start && end ? Math.max(0, (end - start) / 1000) : undefined };
  });

  let note: string | undefined;
  let eta: number | null = null;
  if (current >= 0) {
    const inStep = Math.max(0, (now - stepStart) / 1000);
    let remaining = 0;
    if (current === 0) {
      // Waiting in Batch: RUNNABLE = waiting for a GPU instance, STARTING = pulling the image.
      const status = job?.status;
      note = status ? `Batch: ${status}${job?.statusReason ? ` — ${job.statusReason}` : ""}` : "Waiting for AWS Batch";
      remaining = status === "STARTING" ? 90 : status === "RUNNING" ? 0 : Math.max(60, STEPS[0].est(D, n) - inStep);
    } else if (source.stage === "producing") {
      // Use the observed per-clip time once at least one clip has finished.
      const producingFor = Math.max(0, (now - (entered.get("producing") ?? stepStart)) / 1000);
      const perClip = clipsDone > 0 ? producingFor / clipsDone : 120;
      remaining = Math.max(15, (n - clipsDone) * perClip - (clipsDone > 0 ? 0 : producingFor));
      note = `Rendering clip ${Math.min(clipsDone + 1, n)} of ${n}`;
    } else {
      remaining = Math.max(15, STEPS[current].est(D, n) - inStep);
      note = STEPS[current].label;
    }
    for (let i = current + 1; i < STEPS.length; i++) remaining += STEPS[i].est(D, n);
    // Before the download finishes the video length is unknown, so later steps can't be sized.
    eta = D > 0 ? remaining : null;
  }
  return {
    steps,
    // Finished sources: total run time, not time since.
    elapsed: Math.max(0, ((ACTIVE_STAGES.has(source.stage) ? now : stepStart) - queuedAt) / 1000),
    eta,
    note,
    clipsDone,
    clipsTotal: clips.length || undefined,
  };
}

/**
 * Ask AWS Batch about sources the dashboard thinks are still running. A job that died without
 * reporting back (crash at startup, cost guard, timeout) is marked failed here, with its reason
 * and last log lines, instead of sitting in "queued" forever.
 */
export async function syncBatch(
  env: Env,
  sources: SourceRow[],
): Promise<{ jobs: Map<string, BatchJob>; error?: string }> {
  const active = sources.filter((s) => ACTIVE_STAGES.has(s.stage) && s.batch_job_id);
  if (active.length === 0) return { jobs: new Map() };
  let jobs: Map<string, BatchJob>;
  try {
    jobs = await describeJobs(env, active.map((s) => s.batch_job_id!));
  } catch (err) {
    return { jobs: new Map(), error: String(err instanceof Error ? err.message : err) };
  }
  await Promise.all(
    active.map(async (s) => {
      const job = jobs.get(s.batch_job_id!);
      if (!job || (job.status !== "FAILED" && job.status !== "SUCCEEDED")) return;
      // Something (a local run, a newer job) updated the source after this job stopped: leave it alone.
      if (job.stoppedAt && d1Time(s.updated_at) > job.stoppedAt + 5000) return;
      let tail = "";
      if (job.container?.logStreamName) {
        try {
          tail = (await logTail(env, job.container.logStreamName, 15)).map((l) => l.message).join("\n");
        } catch {
          /* logs are a nice-to-have here */
        }
      }
      const why =
        job.status === "FAILED"
          ? `Batch job failed: ${job.statusReason ?? "unknown"}${job.container?.exitCode != null ? ` (exit ${job.container.exitCode})` : ""}`
          : "Batch job exited without reporting a result";
      const error = tail ? `${why}\n\n${tail}` : why;
      await db.setSourceStage(env.DB, s.id, { stage: "failed", error: error.slice(0, 2000) });
      s.stage = "failed";
      s.error = error;
    }),
  );
  return { jobs };
}

export function fmtDuration(sec: number): string {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
