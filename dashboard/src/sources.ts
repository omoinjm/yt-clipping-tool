import { AwsClient } from "aws4fetch";

export const PERMISSIONS = ["own", "granted", "cc_by"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

export type NewSource = {
  id: string;
  kind: "url" | "upload";
  url: string;
  uploadKey: string;
  owner: string;
  permission: Permission;
  proof: string;
  credit: string;
  clips: number;
};

export function sourceKeyFor(id: string, filename: string): string | null {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!ID_RE.test(id) || !VIDEO_EXTS.includes(ext)) return null;
  return `sources/${id}/source${ext}`;
}

export function isSourceKey(id: string, key: string): boolean {
  return VIDEO_EXTS.some((ext) => key === `sources/${id}/source${ext}`);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Same rules as clipper/sources.py check_permission (the Batch job re-checks them). */
export function validate(s: NewSource): string[] {
  const errors: string[] = [];
  if (!ID_RE.test(s.id)) errors.push("ID: 2–41 chars, lowercase letters, digits, - or _ (start with a letter/digit).");
  if (!PERMISSIONS.includes(s.permission)) errors.push("Pick a permission type.");
  if (!s.owner.trim()) errors.push("Owner / creator name is required.");
  if (s.kind === "url") {
    try {
      const u = new URL(s.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      errors.push("Enter a valid video URL.");
    }
  } else if (!isSourceKey(s.id, s.uploadKey)) {
    errors.push("Upload the video file first.");
  }
  if (s.permission === "granted" && (!s.proof.trim() || !s.credit.trim()))
    errors.push("“Permission granted” needs a link to the proof and a credit line.");
  if (s.permission === "cc_by") {
    if (s.kind !== "url") errors.push("Creative Commons needs the video URL so the license can be verified.");
    if (!s.credit.trim()) errors.push("Creative Commons requires crediting the creator.");
  }
  if (!(s.clips >= 1 && s.clips <= 10)) errors.push("Clips: 1–10.");
  return errors;
}

export async function submitBatchJob(env: Env, sourceId: string, clips: number): Promise<string> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS submit key not configured");
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: "batch",
  });
  const res = await aws.fetch(`https://batch.${env.AWS_REGION}.amazonaws.com/v1/submitjob`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobName: `clipper-${sourceId}`,
      jobQueue: env.BATCH_JOB_QUEUE,
      jobDefinition: env.BATCH_JOB_DEFINITION,
      containerOverrides: {
        command: ["cloud-run", sourceId],
        environment: [{ name: "CLIPS_PER_SOURCE", value: String(clips) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Batch SubmitJob failed: ${res.status} ${await res.text()}`);
  const data = await res.json<{ jobId: string }>();
  return data.jobId;
}
