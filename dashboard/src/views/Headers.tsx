import { raw } from "hono/html";
import { cssText, FONTS, headerCss, splitHighlight, type HeaderStyle } from "../../../remotion/src/header";
import type { ClipRow } from "../db";
import { parseStyle, type HeaderStyleRow, type ResolvedHeader } from "../headers";
import type { RenderJobRow } from "../rerender";
import { ago, Flash, Pill } from "./Layout";

/** Google Fonts for the previews: the same families the renderer loads (remotion/src/font.ts). */
export const FONT_LINK = raw(
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Bangers&family=Bebas+Neue` +
    `&family=Inter:wght@600;700;800;900&family=Montserrat:wght@600;700;800;900&family=Oswald:wght@500;600;700` +
    `&family=Poppins:wght@600;700;800;900&display=swap">`,
);

/**
 * The header drawn over a 9:16 frame, using the renderer's own CSS (headerCss), scaled from 1080×1920.
 * Shows the header's settled state (after its entrance animation).
 */
export function HeaderPreview(props: { style: HeaderStyle; text: string; width: number; bg?: string | null; id?: string }) {
  const css = headerCss(props.style);
  const scale = props.width / 1080;
  const parts = splitHighlight(props.text || "Your header text");
  const box = { ...css.box, transform: `rotate(${props.style.rotate}deg)` };
  return (
    <div class="hp" id={props.id} style={`width:${props.width}px;height:${Math.round(props.width * 16 / 9)}px`}>
      {props.bg ? <img src={props.bg} alt="" loading="lazy" /> : <div class="hp-bg" />}
      <div class="hp-stage" style={`transform:scale(${scale})`}>
        <div style={cssText(css.layer)}>
          <div style={cssText(box)}>
            {parts.map((p) => (p.hl ? <span style={cssText(css.highlight)}>{p.t}</span> : p.t))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const HEADER_CSS = `
.hp{position:relative;overflow:hidden;border-radius:12px;background:#000;flex:none}
.hp>img,.hp>.hp-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hp>.hp-bg{background:linear-gradient(160deg,#334155,#1e1b4b 60%,#0f172a)}
.hp-stage{position:absolute;top:0;left:0;width:1080px;height:1920px;transform-origin:0 0}
.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.hs-card{display:flex;flex-direction:column;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px}
.editor{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
.editor .pv{position:sticky;top:74px;display:flex;flex-direction:column;gap:10px}
@media (max-width:860px){.editor{grid-template-columns:1fr}.editor .pv{position:static;order:-1}}
.ctl{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.ctl input[type=color]{padding:2px;height:38px}
fieldset.grp{border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px 14px;margin:0;display:flex;flex-direction:column;gap:12px}
fieldset.grp legend{padding:0 6px;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
`;

/** Re-fetch the preview while editing (server renders it with the same CSS as the video). */
export const PREVIEW_JS = `
(function(){var f=document.querySelector('form[data-preview]');if(!f)return;var t;
  function go(){clearTimeout(t);t=setTimeout(function(){var q=new URLSearchParams(new FormData(f));
    q.set('w',f.dataset.w||'320');if(f.dataset.bg)q.set('bg',f.dataset.bg);
    fetch('/headers/preview?'+q).then(function(r){return r.text()}).then(function(h){var el=document.getElementById(f.dataset.preview);if(el)el.outerHTML=h})},120)}
  f.addEventListener('input',go);f.addEventListener('change',go);
})();`;

const sample = "They sent you to *collect*? Really?";

export function StylesPage(props: { styles: HeaderStyleRow[]; defaultId: string; bg: string | null; flash?: string }) {
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Header styles</h1>
          <p class="sub" style="margin:4px 0 0">The header over the start of each clip. Channels pick a default; clips can override it. Wrap words in *asterisks* to highlight them.</p>
        </div>
        <a class="btn primary" href="/headers/new">+ New style</a>
      </div>
      <Flash msg={props.flash} />
      <div class="hs-grid">
        {props.styles.map((s) => (
          <div class="hs-card">
            <HeaderPreview style={parseStyle(s)} text={sample} width={186} bg={props.bg} />
            <div>
              <div class="row" style="gap:6px"><b>{s.name}</b>{s.id === props.defaultId ? <Pill v="published" label="default" /> : null}{s.builtin ? <span class="chip dim">built-in</span> : null}</div>
              {s.note ? <div class="muted small" style="margin-top:4px">{s.note}</div> : null}
            </div>
            <div class="row" style="margin-top:auto">
              <a class="btn sm" href={s.builtin ? `/headers/new?from=${s.id}` : `/headers/${s.id}`}>{s.builtin ? "Copy & edit" : "Edit"}</a>
              {s.id !== props.defaultId ? (
                <form method="post" action={`/headers/${s.id}/default`}><button class="sm ghost">Set as default</button></form>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Field(props: { label: string; children: unknown }) {
  return <label>{props.label}{props.children as never}</label>;
}

const opt = (v: string, cur: string, label?: string) => <option value={v} selected={v === cur}>{label ?? v}</option>;

export function EditorPage(props: { row: HeaderStyleRow | null; style: HeaderStyle; name: string; bg: string | null; flash?: string; usedBy?: string }) {
  const s = props.style;
  const builtin = !!props.row?.builtin;
  const id = props.row && !builtin ? props.row.id : "";
  return (
    <>
      <a class="crumb" href="/headers">← Header styles</a>
      <div class="page-head">
        <div>
          <h1>{id ? `Edit “${props.name}”` : "New header style"}</h1>
          {props.usedBy ? <p class="sub" style="margin:4px 0 0">{props.usedBy}</p> : null}
        </div>
      </div>
      <Flash msg={props.flash} />
      <form method="post" action="/headers/save" data-preview="hp-live" data-w="320" data-bg={props.bg ?? ""} class="editor">
        <div class="stack">
          <input type="hidden" name="id" value={id} />
          <label>Name<input name="name" value={props.name} maxlength={60} required /></label>
          <label>Preview text <span style="font-weight:400">(preview only; wrap words in *asterisks* to highlight)</span>
            <input name="text" value={sample} /></label>

          <fieldset class="grp"><legend>Text</legend>
            <div class="ctl">
              <Field label="Font"><select name="font">{Object.keys(FONTS).map((f) => opt(f, s.font))}</select></Field>
              <Field label="Weight"><select name="weight">{[400, 500, 600, 700, 800, 900].map((w) => opt(String(w), String(s.weight)))}</select></Field>
              <Field label="Size"><input type="number" name="size" min="24" max="160" value={String(s.size)} /></Field>
              <Field label="Text color"><input type="color" name="color" value={s.color} /></Field>
              <Field label="Letter spacing"><input type="number" name="letterSpacing" min="-4" max="20" step="0.5" value={String(s.letterSpacing)} /></Field>
              <Field label="Line height"><input type="number" name="lineHeight" min="0.8" max="1.8" step="0.05" value={String(s.lineHeight)} /></Field>
              <Field label="Outline color"><input type="color" name="strokeColor" value={s.strokeColor} /></Field>
              <Field label="Outline width"><input type="number" name="strokeWidth" min="0" max="30" value={String(s.strokeWidth)} /></Field>
              <Field label="Highlight text"><input type="color" name="highlightColor" value={s.highlightColor} /></Field>
            </div>
            <div class="row" style="gap:18px">
              <label class="check"><input type="checkbox" name="uppercase" value="on" checked={s.uppercase} /> UPPERCASE</label>
              <label class="check"><input type="checkbox" name="shadow" value="on" checked={s.shadow} /> Shadow</label>
              <label class="check"><input type="checkbox" name="hlbg_on" value="on" checked={!!s.highlightBg}
                onchange="this.form.highlightBg.disabled=!this.checked" /> Highlight block</label>
              <input type="color" name="highlightBg" value={s.highlightBg || "#FFD84D"} disabled={!s.highlightBg} style="width:60px" aria-label="Highlight block color" />
            </div>
          </fieldset>

          <fieldset class="grp"><legend>Box</legend>
            <div class="ctl">
              <Field label="Shape"><select name="box">
                {opt("rect", s.box, "Rounded box")}{opt("pill", s.box, "Pill")}{opt("banner", s.box, "Full-width bar")}{opt("none", s.box, "No box (text only)")}
              </select></Field>
              <Field label="Box color"><input type="color" name="bg" value={s.bg} /></Field>
              <Field label="Box opacity"><input type="range" name="bgOpacity" min="0" max="1" step="0.05" value={String(s.bgOpacity)} /></Field>
              <Field label="Corner radius"><input type="number" name="radius" min="0" max="200" value={String(s.radius)} /></Field>
              <Field label="Padding (sides)"><input type="number" name="paddingX" min="0" max="120" value={String(s.paddingX)} /></Field>
              <Field label="Padding (top/bottom)"><input type="number" name="paddingY" min="0" max="120" value={String(s.paddingY)} /></Field>
              <Field label="Border color"><input type="color" name="borderColor" value={s.borderColor} /></Field>
              <Field label="Border width"><input type="number" name="borderWidth" min="0" max="20" value={String(s.borderWidth)} /></Field>
              <Field label="Tilt (°)"><input type="number" name="rotate" min="-15" max="15" step="0.5" value={String(s.rotate)} /></Field>
              <Field label="Max width"><input type="number" name="maxWidth" min="300" max="1080" step="10" value={String(s.maxWidth)} /></Field>
            </div>
          </fieldset>

          <fieldset class="grp"><legend>Placement & motion</legend>
            <div class="ctl">
              <Field label="Position"><select name="position">{opt("top", s.position, "Top")}{opt("center", s.position, "Middle")}{opt("bottom", s.position, "Bottom")}</select></Field>
              <Field label="Distance from edge"><input type="number" name="offsetY" min="0" max="900" step="10" value={String(s.offsetY)} /></Field>
              <Field label="Entrance"><select name="animation">{opt("pop", s.animation, "Pop")}{opt("slide", s.animation, "Slide down")}{opt("fade", s.animation, "Fade")}{opt("none", s.animation, "None")}</select></Field>
              <Field label="On screen for (s)"><input type="number" name="duration" min="0" max="60" step="0.5" value={String(s.duration)} /></Field>
            </div>
            <span class="muted small" style="margin-top:-4px">On screen 0 = the whole clip (like podcast title bars). Keep top headers below ~200 so app buttons don't cover them.</span>
          </fieldset>

          <div class="row">
            <button class="primary" type="submit" name="as" value={id ? "save" : "new"}>{id ? "Save" : "Save style"}</button>
            {id ? <button type="submit" name="as" value="new">Save as copy</button> : null}
            {id ? (
              <button class="danger ghost right" type="submit" formaction={`/headers/${id}/delete`} formnovalidate data-confirm-title="Delete this style?"
                data-confirm-ok="Delete style" data-confirm="Channels and clips using it fall back to their default style.">Delete</button>
            ) : null}
          </div>
        </div>
        <div class="pv">
          <HeaderPreview id="hp-live" style={s} text={sample} width={320} bg={props.bg} />
          <span class="muted small">Live preview, drawn exactly like the render (shown after the entrance animation).</span>
        </div>
      </form>
    </>
  );
}

/** Header section on the clip page: text, style, live preview and re-render status. */
export function ClipHeaderPanel(props: {
  clip: ClipRow; resolved: ResolvedHeader; styles: HeaderStyleRow[]; channelStyleName: string | null; defaultName: string;
  job: RenderJobRow | null; canRerender: boolean; posted: boolean;
}) {
  const c = props.clip;
  const current = c.rendered_style === props.resolved.hash;
  const running = props.job?.status === "running";
  const bg = c.thumb_key ? `/media/${c.thumb_key}` : null;
  return (
    <section class="panel" style="display:flex;flex-direction:column;gap:14px;margin-top:16px">
      <div class="row" style="justify-content:space-between">
        <b>Header</b>
        {running ? <Pill v="processing" label="re-rendering…" />
          : current ? <Pill v="published" label="video is up to date" />
          : c.rendered_style ? <Pill v="processing" label="changed: re-render to apply" /> : null}
      </div>
      <div class="row" style="align-items:flex-start;gap:18px;flex-wrap:wrap">
        <HeaderPreview id="hp-clip" style={props.resolved.style} text={c.hook ?? ""} width={170} bg={bg} />
        <form method="post" action={`/clips/${c.id}/header`} class="stack grow" style="min-width:240px"
          data-preview="hp-clip" data-w="170" data-bg={bg ?? ""}>
          <label>Header text <span style="font-weight:400">(*asterisks* highlight words)</span>
            <input name="text" value={c.hook ?? ""} maxlength={120} /></label>
          <label>Style
            <select name="header_style_id">
              <option value="" selected={!c.header_style_id}>
                {props.channelStyleName ? `Channel default (${props.channelStyleName})` : `Default (${props.defaultName})`}
              </option>
              {props.styles.map((s) => <option value={s.id} selected={c.header_style_id === s.id}>{s.name}</option>)}
            </select>
          </label>
          <input type="hidden" name="clip" value={c.id} />
          <div class="row">
            <button type="submit" name="then" value="save">Save</button>
            <button type="submit" name="then" value="render" class="primary" disabled={running || !props.canRerender}>Save & re-render</button>
            <a class="btn sm ghost" href="/headers">Edit styles</a>
          </div>
          {!props.canRerender ? <span class="muted small">This clip was made before re-renders existed. Retry its source on the GPU to apply a new header.</span>
            : <span class="muted small">Re-renders run on a small CPU machine: about 2–4 minutes.{props.posted ? " Copies already posted won't change." : ""}</span>}
          {running ? <span class="muted small">Started {ago(props.job!.created_at)}; this page refreshes when it's done.</span> : null}
          {props.job?.status === "failed" ? <div class="err">Last re-render failed: {props.job.error}</div> : null}
        </form>
      </div>
    </section>
  );
}
