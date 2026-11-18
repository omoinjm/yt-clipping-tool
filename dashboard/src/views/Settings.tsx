import { raw } from "hono/html";
import type { CookieMeta } from "../ytcookies";
import { ago, Flash, Pill } from "./Layout";
import { Logo } from "./Logos";
import { fmtBytes } from "../submissions";

const FILE_JS = `
document.getElementById('ck-file').addEventListener('change',function(e){
  var f=e.target.files[0];if(!f)return;var r=new FileReader();
  r.onload=function(){var t=document.getElementById('ck-text');t.value=r.result;t.dispatchEvent(new Event('input',{bubbles:true}))};r.readAsText(f);
});`;

function expiry(meta: CookieMeta): { text: string; tone: string } {
  if (!meta.expires_at) return { text: "no expiry date in the file", tone: "" };
  const days = Math.floor((meta.expires_at * 1000 - Date.now()) / 86_400_000);
  if (days < 0) return { text: "expired: export new ones", tone: "bad" };
  return { text: `login cookies expire in ${days} day${days === 1 ? "" : "s"}`, tone: days < 14 ? "warn" : "ok" };
}

export type Storage = { full: { bytes: number; count: number }; clips: { bytes: number; count: number }; submissions: { bytes: number; count: number } };

/** Cloudflare R2: first 10 GB free, then $0.015 per GB-month (no download fees). */
function StorageMeter(props: { s: Storage }) {
  const { s } = props;
  const total = s.full.bytes + s.clips.bytes + s.submissions.bytes;
  const gb = total / 1024 ** 3;
  const cost = Math.max(0, gb - 10) * 0.015;
  const row = (label: string, v: { bytes: number; count: number }, unit: string, href?: string) => (
    <tr>
      <td>{href ? <a href={href}>{label}</a> : label}</td>
      <td class="muted">{v.count} {unit}{v.count === 1 ? "" : "s"}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">{fmtBytes(v.bytes)}</td>
      <td style="width:35%"><div class="bar"><i style={`width:${total ? Math.max(1, Math.round((v.bytes / total) * 100)) : 0}%`} /></div></td>
    </tr>
  );
  return (
    <section class="panel" style="display:flex;flex-direction:column;gap:12px">
      <div class="row" style="justify-content:space-between">
        <b>Storage</b>
        <span class="muted small">{fmtBytes(total)} · {cost > 0 ? `≈ $${cost.toFixed(2)}/month` : "within R2's free 10 GB"}</span>
      </div>
      <table>
        <tbody>
          {row("Full videos", s.full, "video", "/videos")}
          {row("Clips", s.clips, "file")}
          {row("Uploads waiting for review", s.submissions, "upload", "/submissions")}
        </tbody>
      </table>
      <p class="muted small" style="margin:0">Delete a full video from its page on Videos. Source uploads expire after 30 days on their own.</p>
    </section>
  );
}

export function SettingsPage(props: { cookies: CookieMeta | null; storage: Storage; flash?: string }) {
  const m = props.cookies;
  const exp = m ? expiry(m) : null;
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <p class="sub" style="margin:4px 0 0">Storage, download cookies and who can sign in.</p>
        </div>
        <a class="btn" href="/users">Manage users →</a>
      </div>
      <Flash msg={props.flash} />
      <StorageMeter s={props.storage} />

      <section class="panel" style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
        <div class="row" style="justify-content:space-between">
          <b class="row" style="gap:8px"><Logo pf="youtube" size={18} /> YouTube download cookies</b>
          {m ? <Pill v={exp?.tone === "bad" ? "failed" : "published"} label={exp?.tone === "bad" ? "expired" : "saved"} /> : <Pill v="none" label="not set" />}
        </div>
        <p class="muted" style="margin:0">
          YouTube often blocks downloads from the GPU servers with “Sign in to confirm you're not a bot”. Cookies from a signed-in
          account get past that. They're only used to download source videos, are stored encrypted, and the job deletes its copy after each download.
        </p>
        {m ? (
          <div class="panel" style="background:var(--bg);display:flex;flex-direction:column;gap:4px">
            <span>{m.youtube} YouTube cookies ({m.total} total) · {m.logged_in ? "signed in" : "not signed in"}</span>
            <span class="muted small" style={exp?.tone === "bad" ? "color:var(--bad)" : exp?.tone === "warn" ? "color:var(--warn)" : undefined}>
              {exp?.text} · saved {ago(m.saved_at.replace("T", " ").slice(0, 19))} by {m.saved_by}
            </span>
          </div>
        ) : null}

        <details class="fold" open={!m}>
          <summary>{m ? "Replace cookies" : "How to export cookies"}</summary>
          <div class="body" style="display:flex;flex-direction:column;gap:12px">
            <ol class="muted" style="margin:0;padding-left:18px;line-height:1.7">
              <li>Use a <b style="color:var(--text)">spare Google account</b>, not your main one: YouTube may flag accounts used from servers.</li>
              <li>Open a <b style="color:var(--text)">private/incognito window</b>, sign in to YouTube, then go to <code>youtube.com/robots.txt</code> in the same tab.</li>
              <li>Export cookies for youtube.com with a cookies.txt extension (e.g. “Get cookies.txt LOCALLY”), Netscape format.</li>
              <li><b style="color:var(--text)">Close the private window</b> right away, so YouTube doesn't rotate the cookies you just exported.</li>
              <li>Upload or paste the file below.</li>
            </ol>
            <form method="post" action="/settings/yt-cookies" class="stack">
              <div class="row">
                <label class="btn sm" style="flex-direction:row;cursor:pointer">
                  Choose cookies.txt file
                  <input type="file" id="ck-file" accept=".txt,text/plain" hidden />
                </label>
                <span class="muted small">or paste it:</span>
              </div>
              <label>
                <textarea id="ck-text" name="cookies" required placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1830000000	LOGIN_INFO	…"
                  style="font:12px/1.5 ui-monospace,monospace;min-height:140px" spellcheck={false} autocomplete="off" />
              </label>
              <div class="row">
                <button class="primary" type="submit">Save cookies</button>
                <span class="muted small">Checked before saving: it must be a signed-in youtube.com export.</span>
              </div>
            </form>
          </div>
        </details>

        {m ? (
          <form method="post" action="/settings/yt-cookies/delete">
            <button class="sm danger ghost" type="submit" data-confirm-title="Remove YouTube cookies?" data-confirm-ok="Remove"
              data-confirm="Jobs will download from YouTube without signing in, which the bot check usually blocks.">Remove cookies</button>
          </form>
        ) : null}
      </section>
      <script>{raw(FILE_JS)}</script>
    </>
  );
}
