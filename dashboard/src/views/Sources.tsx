import type { SourceRow } from "../db";
import { Pill } from "./Layout";

export function SourceTable(props: { sources: SourceRow[] }) {
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
            <td><Pill v={s.stage} /></td>
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
