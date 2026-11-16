import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e7e9ee;--muted:#9aa3b2;--accent:#ffe14d;
--ok:#3ecf8e;--warn:#f5a524;--bad:#f2555a;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6ec;--text:#14171f;--muted:#5d6676}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
a{color:inherit}header{display:flex;gap:16px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
header b{font-size:17px}header nav{display:flex;gap:14px;font-size:14px;color:var(--muted)}header .me{margin-left:auto;color:var(--muted);font-size:13px}
main{max-width:1200px;margin:0 auto;padding:20px 16px}h1{font-size:22px;margin:4px 0 16px}h2{font-size:16px;margin:24px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card img,.card .ph{width:100%;aspect-ratio:9/16;object-fit:cover;background:#000;display:block}
.card .ph{display:grid;place-items:center;color:var(--muted);font-size:13px}
.card .meta{padding:10px;display:flex;flex-direction:column;gap:6px;font-size:13px}
.card .t{font-weight:600;line-height:1.3}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.warn{color:var(--warn);border-color:var(--warn)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.score{font-variant-numeric:tabular-nums;color:var(--accent);font-weight:700}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted)}
.detail{display:grid;grid-template-columns:minmax(260px,380px) 1fr;gap:24px}@media (max-width:760px){.detail{grid-template-columns:1fr}}
video{width:100%;aspect-ratio:9/16;background:#000;border-radius:12px}
form.edit{display:flex;flex-direction:column;gap:12px}label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}
input,textarea,select{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
textarea{min-height:110px;resize:vertical}
button,.btn{font:inherit;font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer;text-decoration:none}
button.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:600}button.danger{color:var(--bad)}
.filters{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}.filters a{font-size:13px}.filters a.on{border-color:var(--accent)}
.err{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;color:var(--bad);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto}
.flash{padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);margin-bottom:14px}
`;

export function Layout(props: { title: string; email: string; refresh?: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {props.refresh ? <meta http-equiv="refresh" content="15" /> : null}
        <title>{props.title} · Clipper</title>
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <header>
          <b>✂ Clipper</b>
          <nav>
            <a href="/">Clips</a>
            <a href="/sources">Sources</a>
            <a href="/sources/new">+ New source</a>
          </nav>
          <span class="me">{props.email}</span>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

const STAGE_TONE: Record<string, string> = {
  published: "ok", uploaded: "ok", done: "ok", rendered: "ok", approved: "ok",
  queued: "warn", running: "warn", rendering: "warn", producing: "warn", transcribed: "warn", scenes: "warn",
  selected: "warn", ingested: "warn", partial: "warn", pending: "",
  failed: "bad", rejected: "bad",
};

export const Pill = (p: { v: string }) => <span class={`pill ${STAGE_TONE[p.v] ?? ""}`}>{p.v}</span>;

export const ACTIVE_STAGES = new Set(["queued", "running", "ingested", "transcribed", "scenes", "selected", "producing"]);
