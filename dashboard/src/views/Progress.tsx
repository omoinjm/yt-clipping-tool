import type { BatchJob, LogLine } from "../aws";
import { fmtDuration, type Progress } from "../progress";

export function ProgressPanel(props: { p: Progress; active: boolean; job: BatchJob | null; batchError?: string }) {
  const { p } = props;
  const finishAt = p.eta != null ? new Date(Date.now() + p.eta * 1000).toISOString().slice(11, 16) : null;
  return (
    <section class="panel">
      <div class="kpis">
        <div><small>{props.active ? "Elapsed" : "Took"}</small><strong>{fmtDuration(p.elapsed)}</strong></div>
        {props.active ? (
          <div>
            <small>ETA</small>
            <strong>{p.eta != null ? `~${fmtDuration(p.eta)}` : "after download"}</strong>
            {finishAt ? <span class="muted small">done ≈ {finishAt} UTC</span> : null}
          </div>
        ) : null}
        {p.clipsTotal ? <div><small>Clips</small><strong>{p.clipsDone}/{p.clipsTotal}</strong></div> : null}
        {props.job ? (
          <div class="right" style="text-align:right">
            <small>AWS Batch</small>
            <strong style="font-size:14px;font-weight:600">{props.job.status.toLowerCase()}</strong>
            {props.job.attempts && props.job.attempts.length > 1 ? <span class="muted small">attempt {props.job.attempts.length}</span> : null}
          </div>
        ) : null}
      </div>
      {props.active && p.note ? <p style="margin:14px 0 0"><span class="pill warn">now</span> {p.note}</p> : null}
      <ol class="stepper">
        {p.steps.map((s) => (
          <li class={s.state}>
            <b>{s.label}</b>
            {s.took != null ? fmtDuration(s.took) : s.state === "active" ? "in progress" : s.state === "failed" ? "failed" : ""}
            {s.label.startsWith("Render") && p.clipsTotal && s.state === "active" ? ` · ${p.clipsDone}/${p.clipsTotal}` : ""}
          </li>
        ))}
      </ol>
      {props.active && p.eta == null ? <p class="muted small" style="margin:12px 0 0">The ETA appears once the video is downloaded and its length is known.</p> : null}
      {props.batchError ? <p class="muted small" style="margin:12px 0 0">Couldn't read AWS Batch status: {props.batchError}</p> : null}
    </section>
  );
}

export function LogPanel(props: { lines: LogLine[] | null; error?: string; stream?: string }) {
  if (props.error) return <p class="muted">Couldn't load logs: {props.error}</p>;
  if (!props.lines) return <p class="muted" style="margin:0">No logs yet: the job hasn't started on a GPU machine.</p>;
  if (props.lines.length === 0) return <p class="muted" style="margin:0">The log stream is empty so far.</p>;
  return (
    <>
      <pre class="logs">
        {props.lines.map((l) => `${new Date(l.timestamp).toISOString().slice(11, 19)}  ${l.message}`).join("\n")}
      </pre>
      <p class="muted small" style="margin:8px 0 0">Last {props.lines.length} lines · CloudWatch /clipper/jobs · {props.stream}</p>
    </>
  );
}

export function RetryForm(props: { id: string; clips: number }) {
  return (
    <form method="post" action={`/sources/${props.id}/retry`} class="row" style="margin:12px 0">
      <label class="check">
        Clips <input type="number" name="clips" min="1" max="10" value={String(props.clips)} style="width:72px" />
      </label>
      <button class="primary" type="submit">Retry on GPU</button>
      <span class="muted small">Resumes from the last checkpoint in S3.</span>
    </form>
  );
}
