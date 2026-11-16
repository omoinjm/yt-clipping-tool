import { AwsClient } from "aws4fetch";

/** Container logs group of the Batch job definition (infra/aws/lib/clipper-stack.ts). */
const JOB_LOG_GROUP = "/clipper/jobs";

export type BatchJob = {
  jobId: string;
  /** SUBMITTED | PENDING | RUNNABLE | STARTING | RUNNING | SUCCEEDED | FAILED */
  status: string;
  statusReason?: string;
  createdAt?: number;
  startedAt?: number;
  stoppedAt?: number;
  container?: { logStreamName?: string; exitCode?: number; reason?: string };
  attempts?: unknown[];
};

export type LogLine = { timestamp: number; message: string };

function client(env: Env, service: "batch" | "logs") {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS key not configured");
  return new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service,
  });
}

export async function submitBatchJob(env: Env, sourceId: string, clips: number): Promise<string> {
  const res = await client(env, "batch").fetch(`https://batch.${env.AWS_REGION}.amazonaws.com/v1/submitjob`, {
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
  return (await res.json<{ jobId: string }>()).jobId;
}

/** Up to 100 job IDs per call. */
export async function describeJobs(env: Env, jobIds: string[]): Promise<Map<string, BatchJob>> {
  const out = new Map<string, BatchJob>();
  if (jobIds.length === 0) return out;
  const res = await client(env, "batch").fetch(`https://batch.${env.AWS_REGION}.amazonaws.com/v1/describejobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs: jobIds.slice(0, 100) }),
  });
  if (!res.ok) throw new Error(`Batch DescribeJobs failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  for (const j of (await res.json<{ jobs: BatchJob[] }>()).jobs) out.set(j.jobId, j);
  return out;
}

/** Last `limit` lines of the job container's CloudWatch log stream, oldest first. */
export async function logTail(env: Env, stream: string, limit = 200): Promise<LogLine[]> {
  const res = await client(env, "logs").fetch(`https://logs.${env.AWS_REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "Logs_20140328.GetLogEvents" },
    body: JSON.stringify({ logGroupName: JOB_LOG_GROUP, logStreamName: stream, limit, startFromHead: false }),
  });
  if (!res.ok) throw new Error(`CloudWatch GetLogEvents failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json<{ events: LogLine[] }>()).events;
}
