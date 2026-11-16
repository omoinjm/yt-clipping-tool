import type { ClipRow } from "../db";
import { Pill } from "./Layout";

export function ClipGrid(props: { clips: ClipRow[] }) {
  if (props.clips.length === 0) return <p class="muted">No clips yet. Submit a source with <code>clipper submit &lt;id&gt;</code>.</p>;
  return (
    <div class="grid">
      {props.clips.map((c) => (
        <a class="card" href={`/clips/${c.id}`}>
          {c.thumb_key ? <img loading="lazy" src={`/media/${c.thumb_key}`} alt="" /> : <div class="ph">{c.stage}</div>}
          <div class="meta">
            <span class="t">{c.title ?? c.id}</span>
            <span class="row">
              <span class="score">{Math.round(c.score ?? 0)}</span>
              <Pill v={c.stage} />
              {c.review !== "pending" ? <Pill v={c.review} /> : null}
              {c.duration ? <span class="muted">{c.duration.toFixed(0)}s</span> : null}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

export function ClipDetail(props: { clip: ClipRow; credit: string | null; flash?: string }) {
  const c = props.clip;
  const tags: string[] = JSON.parse(c.tags || "[]");
  return (
    <>
      <p class="muted"><a href={`/sources/${c.source_id}`}>← {c.source_id}</a></p>
      {props.flash ? <div class="flash">{props.flash}</div> : null}
      <div class="detail">
        <div>
          {c.video_key ? (
            <video controls preload="metadata" playsinline src={`/media/${c.video_key}`} poster={c.thumb_key ? `/media/${c.thumb_key}` : undefined} />
          ) : (
            <div class="card"><div class="ph">not rendered yet ({c.stage})</div></div>
          )}
          <div class="row" style="margin-top:10px">
            {c.video_key ? <a class="btn" href={`/media/${c.video_key}?download=1`}>Download</a> : null}
            {c.youtube_id ? <a class="btn" href={`https://youtube.com/shorts/${c.youtube_id}`} target="_blank">Open on YouTube ↗</a> : null}
          </div>
        </div>
        <div>
          <h1>{c.title ?? c.id}</h1>
          <p class="row">
            <span class="score">score {Math.round(c.score ?? 0)}</span>
            <Pill v={c.stage} /> <Pill v={c.review} />
            <span class="muted">source {c.start.toFixed(1)}–{c.end.toFixed(1)}s{c.layout ? ` · ${c.layout} layout` : ""}</span>
          </p>
          {c.reason ? <p class="muted">Why: {c.reason}</p> : null}
          {c.error ? <div class="err">{c.error}</div> : null}

          <form class="edit" method="post" action={`/clips/${c.id}`}>
            <label>Title<input name="title" maxlength={100} value={c.title ?? ""} /></label>
            <label>Description<textarea name="description">{c.description ?? ""}</textarea></label>
            <label>Tags (comma separated)<input name="tags" value={tags.join(", ")} /></label>
            {props.credit ? <p class="muted">Credit added automatically: “Original: {props.credit}”</p> : null}
            <div class="row">
              <button type="submit" name="review" value="approved" class="primary">Save &amp; approve</button>
              <button type="submit" name="review" value={c.review}>Save</button>
              <button type="submit" name="review" value="rejected" class="danger">Reject</button>
            </div>
          </form>

          <h2>YouTube</h2>
          {c.youtube_id ? (
            <p>Uploaded as <code>{c.youtube_id}</code>. Publish it from YouTube Studio.</p>
          ) : (
            <form method="post" action={`/clips/${c.id}/youtube`} class="row">
              <select name="privacy">
                <option value="private">private (draft)</option>
                <option value="unlisted">unlisted</option>
                <option value="public">public</option>
              </select>
              <button type="submit" class="primary" disabled={!c.video_key}>Upload to YouTube</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
