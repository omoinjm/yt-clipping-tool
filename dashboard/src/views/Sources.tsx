import type { BatchJob } from "../aws";
import type { SourceRow } from "../db";
import { ACTIVE_STAGES } from "../progress";
import { ago, Pill } from "./Layout";

/** Rough progress for the list view (the source page has the real timeline). */
const STAGE_PCT: Record<string, number> = {
  queued: 4, running: 12, ingested: 30, transcribed: 50, scenes: 58, selected: 66, producing: 75, done: 100, partial: 100,
};
const PERMISSION: Record<string, string> = { own: "own", granted: "permission", cc_by: "CC BY" };

export function SourceList(props: { sources: SourceRow[]; jobs?: Map<string, BatchJob>; withFull?: Set<string> }) {
  if (props.sources.length === 0)
    return <div class="empty">No sources yet. <a href="/sources/new">Add your first video</a>.</div>;
  return (
    <div class="src-list">
      {props.sources.map((s) => {
        const active = ACTIVE_STAGES.has(s.stage);
        const job = s.batch_job_id ? props.jobs?.get(s.batch_job_id) : undefined;
        const pct = STAGE_PCT[s.stage] ?? 0;
        return (
          <a class="src" href={`/sources/${s.id}`}>
            <div style="min-width:0">
              <div class="name">{s.id}{props.withFull?.has(s.id) ? <span class="chip" style="margin-left:8px;vertical-align:1px">Full video</span> : null}</div>
              <div class="muted small">{s.owner} · {PERMISSION[s.permission] ?? s.permission}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <span class="row"><Pill v={s.stage} />{s.stage === "queued" && job ? <span class="muted small">{job.status.toLowerCase()}</span> : null}</span>
              {active ? (
                <div class="bar"><i style={`width:${pct}%`} /></div>
              ) : null}
            </div>
            <div class="k"><b>{s.clip_count ?? 0}</b>clips</div>
            <div class="k"><b>{s.posted_count ?? 0}</b>posted</div>
            <div class="k"><b>{s.duration ? `${Math.round(s.duration / 60)}m` : "—"}</b>length</div>
            <div class="k" style="text-align:right"><b style="font-weight:500;font-size:13px">{ago(s.updated_at)}</b>updated</div>
          </a>
        );
      })}
    </div>
  );
}
