import { raw } from "hono/html";
import type { BatchJob, LogLine } from "../aws";
import { fmtDuration, type Progress } from "../progress";

const MARK = { done: "✓", active: "●", todo: "○", failed: "✗" } as const;

export function ProgressPanel(props: { p: Progress; active: boolean; job: BatchJob | null; batchError?: string }) {
  const { p } = props;
  const finishAt = p.eta != null ? new Date(Date.now() + p.eta * 1000).toISOString().slice(11, 16) : null;
  return (
    <section class="panel">
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <span class="muted">{props.active ? "Elapsed" : "Took"}</span> <b>{fmtDuration(p.elapsed)}</b>
          {props.active ? (
            <>
              <span class="muted">· ETA</span>
              <b>{p.eta != null ? `~${fmtDuration(p.eta)}` : "after download"}</b>
              {finishAt ? <span class="muted">(≈ {finishAt} UTC)</span> : null}
            </>
          ) : null}
        </div>
        {props.job ? (
          <span class="muted" style="font-size:12px">
            Batch {props.job.status}
            {props.job.attempts && props.job.attempts.length > 1 ? ` · attempt ${props.job.attempts.length}` : ""}
          </span>
        ) : null}
      </div>
      {props.active && p.note ? <p style="margin:10px 0 0">{p.note}</p> : null}
      {props.active && p.eta == null ? (
        <p class="muted" style="margin:6px 0 0;font-size:13px">The ETA appears once the video is downloaded and its length is known.</p>
      ) : null}
      <ol class="steps">
        {p.steps.map((s) => (
          <li class={s.state}>
            <span class="mark">{MARK[s.state]}</span>
            {s.label}
            {s.label.startsWith("Render") && p.clipsTotal ? <span class="muted"> {p.clipsDone}/{p.clipsTotal}</span> : null}
            {s.took != null ? <span class="muted"> · {fmtDuration(s.took)}</span> : null}
          </li>
        ))}
      </ol>
      {props.batchError ? <p class="muted" style="font-size:12px">Couldn't read AWS Batch status: {props.batchError}</p> : null}
    </section>
  );
}

export function LogPanel(props: { lines: LogLine[] | null; error?: string; stream?: string }) {
  if (props.error) return <p class="muted">Couldn't load logs: {props.error}</p>;
  if (!props.lines) return <p class="muted">No logs yet: the job hasn't started on a GPU machine.</p>;
  if (props.lines.length === 0) return <p class="muted">The log stream is empty so far.</p>;
  return (
    <>
      <pre class="logs" id="logs">
        {props.lines.map((l) => `${new Date(l.timestamp).toISOString().slice(11, 19)}  ${l.message}`).join("\n")}
      </pre>
      <p class="muted" style="font-size:12px">Last {props.lines.length} lines · CloudWatch /clipper/jobs · {props.stream}</p>
      {/* Keep the newest lines in view across the 15 s auto-refresh. */}
      {raw(`<script>const l=document.getElementById("logs");if(l)l.scrollTop=l.scrollHeight</script>`)}
    </>
  );
}

export function RetryForm(props: { id: string; clips: number }) {
  return (
    <form method="post" action={`/sources/${props.id}/retry`} class="row" style="margin:10px 0">
      <label style="flex-direction:row;align-items:center">
        Clips <input type="number" name="clips" min="1" max="10" value={String(props.clips)} style="width:70px" />
      </label>
      <button class="primary" type="submit">Retry on GPU</button>
      <span class="muted" style="font-size:13px">Resumes from the last checkpoint in S3.</span>
    </form>
  );
}
