import type { BatchJob } from "../aws";
import type { SourceRow } from "../db";
import { Pill } from "./Layout";

export function SourceTable(props: { sources: SourceRow[]; jobs?: Map<string, BatchJob> }) {
  if (props.sources.length === 0) return <p class="muted">No sources yet. Run <code>clipper submit &lt;id&gt;</code>.</p>;
  return (
    <table>
      <thead>
        <tr><th>Source</th><th>Status</th><th>Clips</th><th>Length</th><th>Owner</th><th>Updated (UTC)</th></tr>
      </thead>
      <tbody>
        {props.sources.map((s) => (
          <tr>
            <td><a href={`/sources/${s.id}`}>{s.id}</a></td>
            <td>
              <Pill v={s.stage} />
              {/* While queued, the Batch status says whether it's waiting for a GPU (RUNNABLE) or starting. */}
              {s.stage === "queued" && s.batch_job_id && props.jobs?.get(s.batch_job_id)
                ? <span class="muted" style="font-size:12px"> {props.jobs.get(s.batch_job_id)!.status}</span> : null}
            </td>
            <td>{s.clip_count ?? 0}</td>
            <td>{s.duration ? `${Math.round(s.duration / 60)} min` : "—"}</td>
            <td>{s.owner} <span class="muted">({s.permission})</span></td>
            <td class="muted">{s.updated_at}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
