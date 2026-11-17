/**
 * Public upload link (/u/<token>): anyone with the link can upload a video for review.
 * Mounted OUTSIDE the Cloudflare Access middleware; Access needs a Bypass policy for the /u path.
 * Uploaders can't see or do anything else: no clips, no accounts, no posting.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { raw } from "hono/html";
import type { AppEnv } from "./auth";
import {
  CHUNK_BYTES, createSubmission, getSubmission, getUploadToken, ipHash, MAX_UPLOAD_BYTES, recentUploadsFrom,
  sameSecret, setSubmission, UPLOADS_PER_IP_PER_HOUR, validateSubmission, verifyTurnstile, type NewSubmission,
} from "./submissions";
import { VIDEO_EXTS } from "./sources";
import { PublicLayout } from "./views/Layout";

const pub = new Hono<AppEnv>();

// Every route checks the link token first; a wrong or rotated token looks like "no such page".
const checkToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = await getUploadToken(c.env.DB);
  if (!expected || !(await sameSecret(c.req.param("token") ?? "", expected))) {
    return c.req.method === "GET"
      ? c.html(
          <PublicLayout title="Link not active">
            <div class="panel" style="text-align:center;padding:40px 20px">
              <h1>This upload link isn't active</h1>
              <p class="muted">It may have been replaced with a new one. Ask whoever shared it for the current link.</p>
            </div>
          </PublicLayout>,
          404,
        )
      : c.json({ error: "This upload link isn't active." }, 404);
  }
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer"); // the token is in the URL
  return next();
};
pub.use("/:token", checkToken);
pub.use("/:token/*", checkToken);

const CLIENT_JS = `
(function(){
var f=document.getElementById('up'),$=function(s){return f.querySelector(s)};
var base=location.pathname.replace(/\\/$/,'');var file=null;
var drop=$('#drop'),input=$('#file');
function pick(fl){file=fl;$('#fname').textContent=fl?fl.name+' · '+(fl.size>=1073741824?(fl.size/1073741824).toFixed(1)+' GB':Math.round(fl.size/1048576)+' MB'):'';drop.classList.toggle('has',!!fl)}
input.addEventListener('change',function(){pick(input.files[0])});
['dragover','dragenter'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add('over')})});
['dragleave','drop'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove('over')})});
drop.addEventListener('drop',function(e){if(e.dataTransfer.files[0])pick(e.dataTransfer.files[0])});
async function call(path,body,secret){var r=await fetch(base+path,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},secret?{'X-Upload-Secret':secret}:{}),body:JSON.stringify(body)});
  var j=await r.json().catch(function(){return{}});if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
f.addEventListener('submit',async function(e){
  e.preventDefault();var msg=$('#msg');msg.textContent='';msg.className='small';
  if(!file){msg.textContent='Choose a video file first.';msg.className='small err-text';return}
  var btn=$('button[type=submit]'),bar=$('#bar'),st=$('#status');btn.disabled=true;bar.hidden=false;var up;
  try{
    up=await call('/start',{name:f.name.value,email:f.email.value,title:f.title.value,credit:f.credit.value,notes:f.notes.value,
      rights:f.rights.checked,filename:file.name,size:file.size,contentType:file.type||'video/mp4',
      turnstile:(f.querySelector('[name="cf-turnstile-response"]')||{}).value||''});
    var C=up.chunk,parts=[],total=Math.ceil(file.size/C);
    for(var i=0,n=1;i<file.size;i+=C,n++){
      st.textContent='Uploading… '+Math.round(i/file.size*100)+'%';
      var r=await fetch(base+'/part?'+new URLSearchParams({id:up.id,part:n}),{method:'PUT',headers:{'X-Upload-Secret':up.secret},body:file.slice(i,i+C)});
      var j=await r.json().catch(function(){return{}});if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
      parts.push(j);bar.querySelector('i').style.width=Math.min(100,(i+C)/file.size*100)+'%';
    }
    st.textContent='Finishing…';
    await call('/complete',{id:up.id,parts:parts},up.secret);
    document.getElementById('done-name').textContent=file.name;
    f.hidden=true;document.getElementById('done').hidden=false;
  }catch(err){
    if(up)call('/abort',{id:up.id},up.secret).catch(function(){});
    msg.textContent='Upload failed: '+err.message;msg.className='small err-text';st.textContent='';btn.disabled=false;
    if(window.turnstile)turnstile.reset();
  }
});
})();
`;

const PAGE_CSS = `
.pub{max-width:640px;margin:0 auto}
.drop{border:2px dashed var(--line-2);border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;color:var(--muted);transition:border-color .15s,background .15s;display:block}
.drop:hover,.drop.over{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent)}
.drop.has{border-style:solid;border-color:var(--ok)}.drop b{color:var(--text);display:block;font-size:15px;margin-bottom:4px}
.drop input{display:none}.err-text{color:var(--bad)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media (max-width:560px){.two{grid-template-columns:1fr}}
`;

pub.get("/:token", (c) => {
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  return c.html(
    <PublicLayout title="Send a video" head={siteKey ? raw(`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`) : undefined}>
      <style>{raw(PAGE_CSS)}</style>
      <div class="pub">
        <div class="page-head" style="margin-bottom:22px">
          <div>
            <h1>Send us a video</h1>
            <p class="sub" style="margin:6px 0 0">
              Upload a long video (podcast, stream, interview…) and we may turn it into short clips for Shukela Clips on YouTube,
              TikTok and Instagram, crediting you. We review every upload before anything is made or posted.
            </p>
          </div>
        </div>

        <form id="up" class="stack panel" novalidate>
          <label class="drop" id="drop">
            <input type="file" id="file" accept={VIDEO_EXTS.map((e) => `video/*,${e}`).join(",")} />
            <b>Drop a video here, or click to choose</b>
            <span class="small">{VIDEO_EXTS.join(", ")} · up to {Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} GB</span>
            <span class="small" id="fname" style="display:block;margin-top:6px;color:var(--text)" />
          </label>
          <div class="two">
            <label>Your name<input name="name" required maxlength={100} autocomplete="name" /></label>
            <label>Email<input name="email" type="email" required maxlength={200} autocomplete="email" /></label>
          </div>
          <label><span>Video title <span style="font-weight:400">(optional)</span></span><input name="title" maxlength={150} /></label>
          <label>
            <span>How should we credit you? <span style="font-weight:400">(optional)</span></span>
            <input name="credit" maxlength={200} placeholder="e.g. @yourhandle or your channel link" />
          </label>
          <label><span>Anything we should know? <span style="font-weight:400">(optional)</span></span><textarea name="notes" maxlength={2000} style="min-height:80px" /></label>
          <label class="check" style="align-items:flex-start">
            <input type="checkbox" name="rights" style="margin-top:3px" />
            <span>
              I made this video or own the rights to it, and I allow NJMTECH to cut it into short clips and publish them on Shukela Clips
              with credit to me. I've read the <a href="https://njmtech.co.za/clippers-terms" target="_blank" rel="noopener">Terms</a> and{" "}
              <a href="https://njmtech.co.za/clippers-policy" target="_blank" rel="noopener">Privacy Policy</a>.
            </span>
          </label>
          {c.env.TURNSTILE_SITE_KEY ? <div class="cf-turnstile" data-sitekey={c.env.TURNSTILE_SITE_KEY} data-theme="auto" /> : null}
          <div class="bar" id="bar" hidden style="height:8px"><i style="width:0%" /></div>
          <div class="row">
            <button type="submit" class="primary">Upload video</button>
            <span class="muted small" id="status" />
          </div>
          <p class="small" id="msg" style="margin:0" />
        </form>

        <div id="done" class="panel" hidden style="text-align:center;padding:36px 20px">
          <div style="font-size:34px;line-height:1">✓</div>
          <h2 style="margin:10px 0 6px">Thanks, we got it</h2>
          <p class="muted" style="margin:0"><b id="done-name" style="color:var(--text)" /> uploaded. We'll review it and email you if we use it.</p>
          <p style="margin:18px 0 0"><a class="btn" href="">Upload another</a></p>
        </div>
      </div>
      <script>{raw(CLIENT_JS)}</script>
    </PublicLayout>,
  );
});

type Body = Record<string, unknown>;
const str = (b: Body, k: string) => String(b[k] ?? "").trim();
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? "unknown";

pub.post("/:token/start", async (c) => {
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!(await verifyTurnstile(c.env, str(b, "turnstile"), c.req.header("CF-Connecting-IP"))))
    return c.json({ error: "The bot check failed or expired. Please try again." }, 400);
  const s: NewSubmission = {
    name: str(b, "name"), email: str(b, "email"), title: str(b, "title"), notes: str(b, "notes"), credit: str(b, "credit"),
    rights: b.rights === true, filename: str(b, "filename"), size: Number(b.size), contentType: str(b, "contentType"),
  };
  const errors = validateSubmission(s);
  if (errors.length) return c.json({ error: errors.join(" ") }, 400);
  const h = await ipHash(c.env, ip(c));
  if ((await recentUploadsFrom(c.env.DB, h)) >= UPLOADS_PER_IP_PER_HOUR)
    return c.json({ error: "Too many uploads from your network in the last hour. Please try again later." }, 429);
  const up = await createSubmission(c.env, s, h);
  return c.json({ id: up.id, secret: up.secret, chunk: CHUNK_BYTES });
});

/** The submission this request may write to: still uploading, and the per-upload secret matches. */
async function owned(c: { env: Env; req: { header: (n: string) => string | undefined } }, id: string) {
  const sub = await getSubmission(c.env.DB, id);
  const secret = c.req.header("X-Upload-Secret") ?? "";
  if (!sub || sub.status !== "uploading" || !sub.upload_id || !sub.upload_secret || !(await sameSecret(secret, sub.upload_secret))) return null;
  return sub;
}

pub.put("/:token/part", async (c) => {
  const sub = await owned(c, c.req.query("id") ?? "");
  if (!sub) return c.json({ error: "Upload not found or already finished." }, 404);
  const part = Number(c.req.query("part"));
  const len = Number(c.req.header("content-length"));
  if (!(part >= 1 && part <= Math.ceil(sub.size / CHUNK_BYTES)) || !(len > 0 && len <= CHUNK_BYTES) || !c.req.raw.body)
    return c.json({ error: "Bad upload part." }, 400);
  const { readable, writable } = new FixedLengthStream(len);
  const pump = c.req.raw.body.pipeTo(writable);
  const uploaded = await c.env.CLIPS.resumeMultipartUpload(sub.r2_key, sub.upload_id!).uploadPart(part, readable);
  await pump;
  return c.json(uploaded);
});

pub.post("/:token/complete", async (c) => {
  const b = await c.req.json<{ id: string; parts: R2UploadedPart[] }>().catch(() => null);
  const sub = b && (await owned(c, String(b.id)));
  if (!sub || !Array.isArray(b?.parts)) return c.json({ error: "Upload not found or already finished." }, 404);
  await c.env.CLIPS.resumeMultipartUpload(sub.r2_key, sub.upload_id!).complete(b!.parts);
  const head = await c.env.CLIPS.head(sub.r2_key);
  if (!head || head.size > MAX_UPLOAD_BYTES) {
    await c.env.CLIPS.delete(sub.r2_key);
    await setSubmission(c.env.DB, sub.id, { status: "rejected", upload_id: null, upload_secret: null });
    return c.json({ error: "The uploaded file is missing or too large." }, 400);
  }
  await setSubmission(c.env.DB, sub.id, { status: "received", upload_id: null, upload_secret: null });
  return c.json({ ok: true });
});

pub.post("/:token/abort", async (c) => {
  const b = await c.req.json<{ id: string }>().catch(() => null);
  const sub = b && (await owned(c, String(b.id)));
  if (sub) {
    await c.env.CLIPS.resumeMultipartUpload(sub.r2_key, sub.upload_id!).abort().catch(() => {});
    await c.env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(sub.id).run();
  }
  return c.json({ ok: true });
});

export default pub;
