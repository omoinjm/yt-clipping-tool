import type { Child } from "hono/jsx";
import { raw } from "hono/html";

export type Nav = "clips" | "sources" | "new" | "submissions" | "metrics" | "accounts";

const CSS = `
:root{
  --bg:#0b0d12;--panel:#13161d;--panel-2:#1a1e27;--line:#252a35;--line-2:#323846;
  --text:#e8eaf0;--muted:#8f98a8;--accent:#ffd84d;--accent-ink:#1a1606;
  --ok:#34d399;--warn:#f5b440;--bad:#f87171;--info:#60a5fa;
  --yt:#ff4e45;--tt:#25f4ee;--ig:#e1306c;
  --radius:12px;--shadow:0 1px 2px rgb(0 0 0/.25),0 8px 24px rgb(0 0 0/.18);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark;
}
@media (prefers-color-scheme: light){:root{
  --bg:#f5f6f8;--panel:#fff;--panel-2:#f0f2f5;--line:#e3e6ec;--line-2:#d3d8e0;--text:#14171f;--muted:#5d6676;
  --accent:#f5c400;--shadow:0 1px 2px rgb(16 24 40/.06),0 6px 18px rgb(16 24 40/.06);color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}a:hover{color:var(--text)}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel-2);padding:1px 5px;border-radius:5px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* header */
.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1240px;margin:0 auto;padding:10px 16px;display:flex;gap:18px;align-items:center}
.brand{display:flex;gap:8px;align-items:center;font-weight:700;font-size:16px;text-decoration:none;white-space:nowrap}
.brand i{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-style:normal;font-size:14px}
.top nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.top nav a{padding:6px 11px;border-radius:8px;color:var(--muted);text-decoration:none;white-space:nowrap;font-weight:500}
.top nav a:hover{background:var(--panel-2);color:var(--text)}
.top nav a.on{background:var(--panel-2);color:var(--text)}
.top .me{margin-left:auto;color:var(--muted);font-size:12.5px;white-space:nowrap}
@media (max-width:640px){.top .me{display:none}.top .in{gap:10px}}

main{max-width:1240px;margin:0 auto;padding:22px 16px 60px}
h1{font-size:22px;line-height:1.25;margin:0;letter-spacing:-.01em}
h2{font-size:15px;margin:28px 0 12px;letter-spacing:-.005em}
h3{font-size:14px;margin:0 0 8px}
.page-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}
.page-head .sub{color:var(--muted);margin-top:4px}
.crumb{display:inline-flex;gap:6px;align-items:center;color:var(--muted);text-decoration:none;font-size:13px;margin-bottom:10px}
.crumb:hover{color:var(--text)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted)}.small{font-size:12.5px}
.grow{flex:1}.right{margin-left:auto}

/* surfaces */
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.panel+.panel{margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:500;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}
tr:last-child td{border-bottom:0}
.table{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}

/* controls */
label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted);font-weight:500}
input,textarea,select{font:inherit;font-size:14px;color:var(--text);background:var(--bg);border:1px solid var(--line-2);border-radius:9px;padding:9px 11px;width:100%}
input[type=checkbox],input[type=radio]{width:auto;accent-color:var(--accent)}
input:focus,textarea:focus,select:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
textarea{min-height:110px;resize:vertical;line-height:1.45}
.check{flex-direction:row;align-items:center;gap:7px;color:var(--text);font-weight:400;font-size:13.5px}
button,.btn{font:inherit;font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9px;
  border:1px solid var(--line-2);background:var(--panel);color:var(--text);cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,.btn:hover{background:var(--panel-2)}
button.primary,.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
button.primary:hover,.btn.primary:hover{filter:brightness(1.06)}
button.danger,.btn.danger{color:var(--bad)}button.ghost,.btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}
button.ghost:hover,.btn.ghost:hover{color:var(--text);background:var(--panel-2)}
.btn.sm,button.sm{padding:5px 10px;font-size:12.5px}
button:disabled{opacity:.45;cursor:not-allowed;filter:none}
.field-foot{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);font-weight:400}
.count.over{color:var(--bad)}

/* pills, chips */
.pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;background:var(--panel-2);color:var(--muted);white-space:nowrap}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
.pill.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 13%,transparent)}
.pill.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent)}
.pill.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 13%,transparent)}
.pill.info{color:var(--info);background:color-mix(in srgb,var(--info) 13%,transparent)}
.seg{display:inline-flex;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
.seg a{padding:5px 11px;border-radius:7px;text-decoration:none;color:var(--muted);font-weight:500;font-size:13px}
.seg a:hover{color:var(--text)}.seg a.on{background:var(--panel-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--line-2)}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.toolbar select{width:auto;padding:6px 10px;font-size:13px}
.score{font-variant-numeric:tabular-nums;font-weight:700}

/* platform marks: brand logo in a chip; the ring shows the state */
.pf{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:var(--panel-2);color:var(--text);flex:none}
.pf .logo{display:block}
.pf.none .logo{filter:grayscale(1) brightness(1.5);opacity:.5}
.pf.drafted{box-shadow:inset 0 0 0 1.5px var(--info)}
.pf.processing{box-shadow:inset 0 0 0 1.5px var(--warn);animation:pulse 1.6s ease-in-out infinite}
.pf.failed{box-shadow:inset 0 0 0 1.5px var(--bad)}.pf.failed .logo{opacity:.6}
.pf.lg{width:40px;height:40px;border-radius:10px}
.thumb .pf{background:rgb(0 0 0/.62);color:#fff;backdrop-filter:blur(4px)}

/* dialog (replaces window.confirm) */
dialog.modal{border:1px solid var(--line-2);border-radius:14px;background:var(--panel);color:var(--text);padding:0;width:min(420px,calc(100vw - 32px));box-shadow:0 20px 60px rgb(0 0 0/.45)}
dialog.modal::backdrop{background:rgb(5 7 12/.62);backdrop-filter:blur(3px)}
dialog.modal[open]{animation:pop .14s ease-out}
dialog.modal .mb{padding:20px 20px 6px}
dialog.modal h3{font-size:16px;margin:0 0 8px}
dialog.modal p{margin:0;color:var(--muted);line-height:1.55}
dialog.modal .mf{display:flex;justify-content:flex-end;gap:8px;padding:16px 20px 18px}
@keyframes pop{from{opacity:0;transform:translateY(6px) scale(.98)}}

/* clip grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
@media (max-width:520px){.grid{grid-template-columns:1fr 1fr;gap:10px}.card .meta{padding:8px 10px 10px}.card .t{font-size:12.5px}}
.card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;text-decoration:none;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s,border-color .15s}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--line-2)}
.thumb{position:relative;aspect-ratio:9/16;background:#000;overflow:hidden}
.thumb img,.thumb video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.thumb .ph{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:13px}
.thumb .tl,.thumb .br,.thumb .bl{position:absolute;z-index:2}
.thumb .tl{top:8px;left:8px}.thumb .br{bottom:8px;right:8px}.thumb .bl{bottom:8px;left:8px;display:flex;gap:4px}
.ov{background:rgb(0 0 0/.62);color:#fff;font-size:11.5px;font-weight:600;padding:2px 7px;border-radius:6px;backdrop-filter:blur(4px)}
.ov.score{color:var(--accent)}
.card .meta{padding:10px 12px 12px;display:flex;flex-direction:column;gap:7px}
.card .t{font-weight:600;line-height:1.35;font-size:13.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{border:1px dashed var(--line-2);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}

/* clip page */
.detail{display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:28px;align-items:start}
.detail .side{position:sticky;top:74px}
@media (max-width:820px){.detail{grid-template-columns:1fr;gap:18px}.detail .side{position:static;max-width:240px;margin:0 auto;width:100%}.detail .side .row{justify-content:center}}
video.player{width:100%;aspect-ratio:9/16;background:#000;border-radius:var(--radius);display:block}
.status{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}
@media (max-width:560px){.status{gap:6px}.tile{padding:8px}.tile b{font-size:10.5px}.tile span{font-size:12px;gap:5px}}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px;text-decoration:none}
.tile b{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.tile span{font-size:13.5px}
.callout{border-left:3px solid var(--accent);background:var(--panel);padding:10px 14px;border-radius:0 10px 10px 0;color:var(--muted);font-size:13.5px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:8px 0 18px;overflow-x:auto}
.tabs button{border:0;background:none;border-radius:0;padding:10px 14px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button:hover{background:none;color:var(--text)}
.tabs button[aria-selected=true]{color:var(--text);border-bottom-color:var(--accent)}
.js [data-panel]:not(.show){display:none}
form.stack{display:flex;flex-direction:column;gap:14px}
.posts{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px}
.posts li{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.posts .err{width:100%}
.pager{display:flex;gap:6px;align-items:center}

/* feedback */
.flash{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);margin-bottom:16px}
.flash.ok{border-color:color-mix(in srgb,var(--ok) 45%,transparent)}.flash.ok::before{content:"✓";color:var(--ok);font-weight:700}
.flash.bad{border-color:color-mix(in srgb,var(--bad) 45%,transparent)}.flash.bad::before{content:"!";color:var(--bad);font-weight:700}
.err{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:var(--bad);background:color-mix(in srgb,var(--bad) 7%,var(--panel));border:1px solid color-mix(in srgb,var(--bad) 30%,transparent);border-radius:9px;padding:10px 12px;overflow:auto;max-height:240px}

/* sources + progress */
.bar{height:6px;border-radius:99px;background:var(--panel-2);overflow:hidden;min-width:80px}
.bar i{display:block;height:100%;background:var(--accent);border-radius:inherit}
.bar.ok i{background:var(--ok)}.bar.bad i{background:var(--bad)}
.stepper{list-style:none;padding:0;margin:16px 0 0;display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.stepper li{position:relative;padding-top:18px;font-size:12.5px;color:var(--muted)}
.stepper li::before{content:"";position:absolute;top:5px;left:0;right:0;height:3px;border-radius:9px;background:var(--line-2)}
.stepper li.done::before{background:var(--ok)}.stepper li.active::before{background:linear-gradient(90deg,var(--warn),var(--line-2));animation:pulse 1.6s ease-in-out infinite}
.stepper li.failed::before{background:var(--bad)}
.stepper li b{display:block;color:var(--text);font-weight:600;font-size:13px}
.stepper li.todo b{color:var(--muted);font-weight:500}.stepper li.failed b{color:var(--bad)}
@media (max-width:760px){.stepper{grid-template-columns:1fr 1fr}}
@keyframes pulse{50%{opacity:.55}}
.kpis{display:flex;gap:28px;flex-wrap:wrap}.kpis div{display:flex;flex-direction:column}
.kpis small{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.kpis strong{font-size:20px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
details.fold{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin-top:12px}
details.fold>summary{cursor:pointer;padding:12px 16px;font-weight:600;list-style:none;display:flex;gap:8px;align-items:center}
details.fold>summary::before{content:"▸";color:var(--muted);transition:transform .15s}
details.fold[open]>summary::before{transform:rotate(90deg)}
details.fold>.body{padding:0 16px 16px}
pre.logs{max-height:440px;overflow:auto;margin:0;padding:12px;background:#07090d;color:#cfd5df;border:1px solid var(--line);border-radius:10px;font:12px/1.55 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
.src-list{display:flex;flex-direction:column;gap:10px}
.src{display:grid;grid-template-columns:minmax(0,1.6fr) 140px repeat(3,minmax(70px,.5fr)) 110px;gap:14px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 16px;text-decoration:none}
.src:hover{border-color:var(--line-2);box-shadow:var(--shadow)}
.src .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src .k{display:flex;flex-direction:column;font-size:12px;color:var(--muted)}.src .k b{color:var(--text);font-size:14px;font-weight:600}
@media (max-width:900px){.src{grid-template-columns:1fr 1fr}.src .name{grid-column:1/-1}}
[hidden]{display:none!important}
`;

// Small progressive enhancements; every page works without them.
const JS = `
document.documentElement.classList.add('js');
// Tabs: [data-tabs] > button[data-tab]; panels [data-panel]. The URL hash picks the tab (#tiktok).
document.querySelectorAll('[data-tabs]').forEach(function(t){
  var btns=t.querySelectorAll('[data-tab]');
  function show(name){btns.forEach(function(b){var on=b.dataset.tab===name;b.setAttribute('aria-selected',on);
    document.querySelectorAll('[data-panel="'+b.dataset.tab+'"]').forEach(function(p){p.classList.toggle('show',on)})})}
  btns.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.tab);history.replaceState(null,'','#'+b.dataset.tab)})});
  var h=location.hash.slice(1);show([].some.call(btns,function(b){return b.dataset.tab===h})?h:t.dataset.tabs);
});
// Character counters: textarea[data-count=max] updates the .count next to it.
document.querySelectorAll('[data-count]').forEach(function(el){
  var out=el.closest('label').querySelector('.count'),max=+el.dataset.count;
  function u(){var n=el.value.length;out.textContent=n+' / '+max;out.classList.toggle('over',n>max)}
  el.addEventListener('input',u);u();
});
// Copy buttons: button[data-copy=selector].
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
  var el=document.querySelector(b.dataset.copy);var label=b.textContent;
  navigator.clipboard.writeText(el.value||el.textContent).then(function(){b.textContent='Copied ✓';setTimeout(function(){b.textContent=label},1600)});
})});
// Confirm before irreversible actions: button[data-confirm] (+ data-confirm-title, data-confirm-ok) in our own dialog.
(function(){var d=document.getElementById('confirm');if(!d)return;var pending=null;
  document.querySelectorAll('[data-confirm]').forEach(function(b){b.addEventListener('click',function(e){
    if(b.dataset.confirmed){delete b.dataset.confirmed;return}
    e.preventDefault();pending=b;
    d.querySelector('h3').textContent=b.dataset.confirmTitle||'Are you sure?';
    d.querySelector('p').textContent=b.dataset.confirm;
    d.querySelector('[data-ok]').textContent=b.dataset.confirmOk||'Continue';
    d.querySelector('[data-ok]').className=b.classList.contains('danger')?'danger':'primary';
    d.showModal();d.querySelector('[data-ok]').focus();
  })});
  d.querySelector('[data-ok]').addEventListener('click',function(){d.close();if(!pending)return;
    var b=pending;pending=null;b.dataset.confirmed='1';
    if(b.form&&b.form.requestSubmit)b.form.requestSubmit(b);else b.click()});
  d.querySelector('[data-cancel]').addEventListener('click',function(){pending=null;d.close()});
  d.addEventListener('click',function(e){if(e.target===d){pending=null;d.close()}});
})();
// Show/hide by a radio group: [data-when="name=value"].
document.querySelectorAll('[data-when]').forEach(function(el){
  var kv=el.dataset.when.split('='),form=el.closest('form');
  function u(){var on=form.querySelector('input[name="'+kv[0]+'"]:checked');el.hidden=!(on&&on.value===kv[1])}
  form.querySelectorAll('input[name="'+kv[0]+'"]').forEach(function(r){r.addEventListener('change',u)});u();
});
// Hover preview on clip cards (mouse devices only).
if(matchMedia('(hover:hover)').matches)document.querySelectorAll('[data-preview]').forEach(function(c){
  var v;c.addEventListener('mouseenter',function(){v=document.createElement('video');v.src=c.dataset.preview;v.muted=true;v.loop=true;v.playsInline=true;
    v.oncanplay=function(){v.play()};c.querySelector('.thumb').appendChild(v)});
  c.addEventListener('mouseleave',function(){if(v){v.remove();v=null}});
});
// Gentle auto-refresh: never while you're typing or have unsaved edits.
(function(){var s=document.body.dataset.refresh;if(!s)return;var dirty=false;
  document.addEventListener('input',function(){dirty=true});
  function tick(){var a=document.activeElement;if(dirty||(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)))return setTimeout(tick,5000);location.reload()}
  setTimeout(tick,s*1000)})();
// Keep the newest log lines in view.
document.querySelectorAll('pre.logs').forEach(function(l){l.scrollTop=l.scrollHeight});
`;

const NAV: [Nav, string, string][] = [
  ["clips", "/", "Clips"],
  ["sources", "/sources", "Sources"],
  ["new", "/sources/new", "New source"],
  ["submissions", "/submissions", "Submissions"],
  ["metrics", "/metrics", "Metrics"],
  ["accounts", "/accounts", "Accounts"],
];

export function Layout(props: { title: string; email: string; nav?: Nav; refresh?: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Clipper</title>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* use-credentials: the manifest sits behind Cloudflare Access, so the browser must send the login cookie */}
        <link rel="manifest" href="/site.webmanifest" crossorigin="use-credentials" />
        <meta name="theme-color" content="#0b0d12" />
        <meta name="apple-mobile-web-app-title" content="Clipper" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <style>{raw(CSS)}</style>
      </head>
      <body data-refresh={props.refresh ? "15" : undefined}>
        <header class="top">
          <div class="in">
            <a class="brand" href="/"><i>✂</i>Clipper</a>
            <nav>
              {NAV.map(([key, href, label]) => (
                <a href={href} class={props.nav === key ? "on" : undefined} aria-current={props.nav === key ? "page" : undefined}>{label}</a>
              ))}
            </nav>
            <span class="me">{props.email}</span>
          </div>
        </header>
        <main>{props.children}</main>
        <dialog class="modal" id="confirm" aria-labelledby="confirm-title">
          <div class="mb"><h3 id="confirm-title">Are you sure?</h3><p /></div>
          <div class="mf"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-ok>Continue</button></div>
        </dialog>
        <script>{raw(JS)}</script>
      </body>
    </html>
  );
}

/** Shell for public pages (upload link): same look, no navigation, no account details. */
export function PublicLayout(props: { title: string; head?: Child; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title} · Clipper by NJMTECH</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#0b0d12" />
        <style>{raw(CSS)}</style>
        {props.head}
      </head>
      <body>
        <header class="top">
          <div class="in"><span class="brand"><i>✂</i>Clipper <span class="muted" style="font-weight:500;font-size:13px">by NJMTECH</span></span></div>
        </header>
        <main>{props.children}</main>
        <footer class="muted small" style="text-align:center;padding:0 16px 40px">
          <a href="https://njmtech.co.za/clippers-terms" target="_blank" rel="noopener">Terms</a> ·{" "}
          <a href="https://njmtech.co.za/clippers-policy" target="_blank" rel="noopener">Privacy</a>
        </footer>
        <script>{raw(JS)}</script>
      </body>
    </html>
  );
}

const STAGE_TONE: Record<string, string> = {
  published: "ok", uploaded: "ok", done: "ok", rendered: "ok", approved: "ok", drafted: "info",
  queued: "warn", running: "warn", rendering: "warn", producing: "warn", transcribed: "warn", scenes: "warn",
  selected: "warn", ingested: "warn", partial: "warn", processing: "warn",
  failed: "bad", rejected: "bad",
};
const STAGE_LABEL: Record<string, string> = { pending: "to review", selected: "selected", drafted: "in drafts" };

export const Pill = (p: { v: string; label?: string }) => (
  <span class={`pill ${STAGE_TONE[p.v] ?? ""}`}>{p.label ?? STAGE_LABEL[p.v] ?? p.v}</span>
);

/** Flash message; tone guessed from the wording (all flashes come from our own redirects). */
export const Flash = (p: { msg?: string }) =>
  p.msg ? (
    <div class={`flash ${/fail|couldn|error|isn't|expired|choose|not |missing/i.test(p.msg) ? "bad" : "ok"}`} role="status">
      <span>{p.msg}</span>
    </div>
  ) : null;

/** "3h ago" from a D1 UTC timestamp. */
export function ago(d1: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(d1.replace(" ", "T") + "Z")) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export { ACTIVE_STAGES } from "../progress";
