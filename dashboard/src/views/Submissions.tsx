import { fmtBytes, type SubmissionRow } from "../submissions";
import { slugify } from "../sources";
import { ago, Flash, Pill } from "./Layout";

export function SubmissionsPage(props: {
  link: string | null;
  turnstile: boolean;
  subs: SubmissionRow[];
  flash?: string;
}) {
  const pending = props.subs.filter((s) => s.status === "received");
  const rest = props.subs.filter((s) => s.status !== "received");
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Submissions</h1>
          <p class="sub" style="margin:4px 0 0">Videos uploaded through the public link. Nothing is processed until you accept it.</p>
        </div>
      </div>
      <Flash msg={props.flash} />

      <section class="panel" style="display:flex;flex-direction:column;gap:12px">
        <div class="row" style="justify-content:space-between">
          <b>Public upload link</b>
          {props.link ? <Pill v="published" label="on" /> : <Pill v="none" label="off" />}
        </div>
        {props.link ? (
          <>
            <div class="row" style="flex-wrap:nowrap">
              <input id="upload-link" readonly value={props.link} style="font-family:ui-monospace,monospace;font-size:13px" onclick="this.select()" />
              <button type="button" class="sm" data-copy="#upload-link">Copy</button>
            </div>
            <form method="post" action="/submissions/link" class="row">
              <span class="muted small grow">Anyone with this link can upload a video (up to 5 GB, 5 per hour per network). They can't see anything else.</span>
              <button class="sm" name="action" value="rotate" data-confirm-title="Make a new link?" data-confirm-ok="New link"
                data-confirm="The current link stops working right away. Anyone who has it will need the new one.">New link</button>
              <button class="sm danger ghost" name="action" value="off" data-confirm-title="Turn off uploads?" data-confirm-ok="Turn off"
                data-confirm="The link stops working until you create a new one. Uploads already received stay here.">Turn off</button>
            </form>
          </>
        ) : (
          <form method="post" action="/submissions/link" class="row">
            <span class="muted small grow">Create a link to let people send you videos without a dashboard login.</span>
            <button class="primary sm" name="action" value="rotate">Create upload link</button>
          </form>
        )}
        {!props.turnstile ? (
          <p class="err" style="margin:0;color:var(--warn)">Bot protection (Turnstile) isn't configured: set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.</p>
        ) : null}
      </section>

      <h2>To review <span class="muted" style="font-weight:400">{pending.length}</span></h2>
      {pending.length === 0 ? <div class="empty">Nothing waiting. New uploads appear here.</div> : null}
      <div class="src-list">
        {pending.map((s) => (
          <div class="panel" style="display:grid;grid-template-columns:minmax(0,220px) 1fr;gap:18px;align-items:start">
            <video class="player" controls preload="metadata" playsinline src={`/media/${s.r2_key}`} style="aspect-ratio:auto;max-height:360px;object-fit:contain" />
            <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
              <div>
                <h3 style="margin:0 0 4px">{s.title || s.filename}</h3>
                <div class="muted small">
                  {s.name} · <a href={`mailto:${s.email}`}>{s.email}</a> · {fmtBytes(s.size)} · {ago(s.created_at)}
                </div>
              </div>
              {s.credit ? <div class="small">Credit as: <b>{s.credit}</b></div> : null}
              {s.notes ? <p class="callout" style="margin:0;white-space:pre-wrap">{s.notes}</p> : null}
              <div class="muted small">Rights confirmed by the uploader · <code>{s.id}</code></div>
              <form method="post" action={`/submissions/${s.id}/accept`} class="row" style="margin-top:4px">
                <label style="flex:1;min-width:180px">
                  Source ID
                  <input name="source_id" value={slugify(s.title || s.filename) || s.id} pattern="[a-z0-9][a-z0-9_\-]{1,40}" required />
                </label>
                <label style="width:90px">
                  Clips
                  <input name="clips" type="number" min="1" max="10" value="5" />
                </label>
                <div class="row" style="align-self:flex-end">
                  <button class="primary" type="submit">Accept &amp; start clipping</button>
                  <button class="danger ghost" type="submit" formaction={`/submissions/${s.id}/reject`} formnovalidate
                    data-confirm-title="Reject this upload?" data-confirm-ok="Reject and delete"
                    data-confirm={`The video from ${s.name} is deleted from storage. This can't be undone.`}>Reject</button>
                </div>
              </form>
            </div>
          </div>
        ))}
      </div>

      {rest.length ? (
        <details class="fold" style="margin-top:20px">
          <summary>History <span class="muted" style="font-weight:400">{rest.length}</span></summary>
          <div class="body">
            <table>
              <tbody>
                {rest.map((s) => (
                  <tr>
                    <td><Pill v={s.status === "accepted" ? "done" : s.status === "rejected" ? "rejected" : "processing"} label={s.status} /></td>
                    <td>{s.title || s.filename}<div class="muted small">{s.name} · {s.email}</div></td>
                    <td class="muted small">{fmtBytes(s.size)}</td>
                    <td class="muted small">{ago(s.created_at)}</td>
                    <td>{s.source_id ? <a class="btn sm" href={`/sources/${s.source_id}`}>Source →</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}
