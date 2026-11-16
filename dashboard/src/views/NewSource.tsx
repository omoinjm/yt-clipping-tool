import { raw } from "hono/html";
import { VIDEO_EXTS, type NewSource } from "../sources";

const FORM_CSS = `
.nf{display:grid;gap:18px;max-width:720px}.nf fieldset{border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:grid;gap:12px;margin:0}
.nf legend{padding:0 6px;color:var(--muted);font-size:13px}.choice{display:grid;gap:8px}
.choice label{flex-direction:row;align-items:flex-start;gap:10px;color:var(--text);font-size:14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}
.choice label:has(input:checked){border-color:var(--accent)}.choice small{display:block;color:var(--muted);font-size:12.5px;margin-top:3px}
.hint{color:var(--muted);font-size:12.5px}.errs{border:1px solid var(--bad);border-radius:10px;padding:10px 14px;color:var(--bad)}
progress{width:100%;height:10px}[hidden]{display:none!important}
`;

const CLIENT_JS = `
const f = document.getElementById('nf');
const $ = (s) => f.querySelector(s);
function sync() {
  const kind = f.kind.value, perm = f.permission.value;
  $('#url-box').hidden = kind !== 'url';
  $('#file-box').hidden = kind !== 'upload';
  $('#proof-box').hidden = perm !== 'granted';
  $('#credit-box').hidden = perm === 'own';
  $('#cc-note').hidden = perm !== 'cc_by';
  f.querySelector('input[value=cc_by]').disabled = kind === 'upload';
  if (kind === 'upload' && perm === 'cc_by') f.querySelector('input[value=own]').checked = true;
}
f.addEventListener('change', sync); sync();
$('#file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && !f.id.value) f.id.value = file.name.toLowerCase().replace(/\\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
});
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
f.addEventListener('submit', async (e) => {
  if (f.kind.value !== 'upload' || f.upload_key.value) return;
  e.preventDefault();
  const file = $('#file').files[0];
  if (!file) { alert('Choose a video file'); return; }
  if (!f.id.value) { alert('Enter an ID'); return; }
  const btn = $('button[type=submit]'), bar = $('#progress'), status = $('#upload-status');
  btn.disabled = true; bar.hidden = false;
  let up;
  try {
    up = await post('/uploads', { id: f.id.value, filename: file.name, contentType: file.type || 'video/mp4' });
    const CHUNK = 32 * 1024 * 1024, parts = [];
    for (let i = 0, n = 1; i < file.size; i += CHUNK, n++) {
      status.textContent = 'Uploading part ' + n + ' of ' + Math.ceil(file.size / CHUNK) + '…';
      const r = await fetch('/uploads/part?' + new URLSearchParams({ key: up.key, uploadId: up.uploadId, part: n }), { method: 'PUT', body: file.slice(i, i + CHUNK) });
      if (!r.ok) throw new Error(await r.text());
      parts.push(await r.json());
      bar.value = Math.min(1, (i + CHUNK) / file.size);
    }
    status.textContent = 'Finishing upload…';
    await post('/uploads/complete', { key: up.key, uploadId: up.uploadId, parts });
    f.upload_key.value = up.key;
    status.textContent = 'Uploaded ✓ Starting job…';
    f.submit();
  } catch (err) {
    if (up) post('/uploads/abort', { key: up.key, uploadId: up.uploadId }).catch(() => {});
    status.textContent = 'Upload failed: ' + err.message; btn.disabled = false;
  }
});
`;

export function NewSourceForm(props: { values?: Partial<NewSource>; errors?: string[] }) {
  const v = { kind: "url", permission: "own", owner: "", clips: 5, ...props.values };
  return (
    <>
      <style>{raw(FORM_CSS)}</style>
      <p class="muted"><a href="/sources">← Sources</a></p>
      <h1>New source</h1>
      {props.errors?.length ? (
        <div class="errs"><ul>{props.errors.map((e) => <li>{e}</li>)}</ul></div>
      ) : null}
      <form id="nf" class="nf edit" method="post" action="/sources/new">
        <fieldset>
          <legend>Video</legend>
          <div class="choice row">
            <label><input type="radio" name="kind" value="url" checked={v.kind === "url"} /> Paste a URL</label>
            <label><input type="radio" name="kind" value="upload" checked={v.kind === "upload"} /> Upload a file</label>
          </div>
          <label id="url-box">Video URL (YouTube or any yt-dlp supported site)
            <input name="url" type="url" placeholder="https://www.youtube.com/watch?v=…" value={v.url ?? ""} />
          </label>
          <div id="file-box">
            <label>Video file ({VIDEO_EXTS.join(", ")})<input id="file" type="file" accept={VIDEO_EXTS.join(",")} /></label>
            <progress id="progress" value="0" max="1" hidden />
            <span id="upload-status" class="hint" />
            <input type="hidden" name="upload_key" value={v.uploadKey ?? ""} />
          </div>
          <label>ID (used for clip names)
            <input name="id" required pattern="[a-z0-9][a-z0-9_\-]{1,40}" placeholder="podcast-ep01" value={v.id ?? ""} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Rights</legend>
          <div class="choice">
            <label><input type="radio" name="permission" value="own" checked={v.permission === "own"} />
              <span>I own it<small>You made this video or own its rights.</small></span></label>
            <label><input type="radio" name="permission" value="cc_by" checked={v.permission === "cc_by"} />
              <span>Creative Commons (CC BY): credit only
                <small>The video is published under Creative Commons Attribution (YouTube shows “License: Creative Commons Attribution”). The job verifies the license before downloading and stops if it isn't CC BY.</small></span></label>
            <label><input type="radio" name="permission" value="granted" checked={v.permission === "granted"} />
              <span>The creator gave me permission<small>Written permission (email, DM, contract). Standard-license videos need this; credit alone isn't enough.</small></span></label>
          </div>
          <label>Owner / creator name<input name="owner" required placeholder="NJM Tech or the creator's name" value={v.owner ?? ""} /></label>
          <label id="credit-box">Credit line (added to every YouTube description)
            <input name="credit" placeholder="@creatorhandle on YouTube" value={v.credit ?? ""} /></label>
          <label id="proof-box">Proof of permission (link to email, DM screenshot, or contract)
            <input name="proof" placeholder="https://…" value={v.proof ?? ""} /></label>
          <p id="cc-note" class="hint">Only plain CC BY qualifies. NonCommercial (NC) and NoDerivatives (ND) licenses are rejected, because monetized, edited Shorts need both commercial use and edits.</p>
        </fieldset>

        <fieldset>
          <legend>Output</legend>
          <label>Number of Shorts to make<input name="clips" type="number" min="1" max="10" value={String(v.clips ?? 5)} /></label>
        </fieldset>

        <div class="row"><button type="submit" class="primary">Start clipping</button>
          <span class="hint">Runs on an AWS GPU; clips appear here when ready.</span></div>
      </form>
      <script>{raw(CLIENT_JS)}</script>
    </>
  );
}
