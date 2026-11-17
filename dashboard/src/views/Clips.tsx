import type { Child } from "hono/jsx";
import type { ClipRow } from "../db";
import type { ChannelRow } from "../channels";
import type { PostRow } from "../social/posts";
import type { Platform } from "../social/tokens";
import { Flash, Pill } from "./Layout";
import { Logo } from "./Logos";
import { compact, total, type ClipMetrics } from "../social/metrics";
import { StatLine } from "./Metrics";

export type AnyPlatform = "youtube" | Platform;
export type PState = { state: "live" | "drafted" | "processing" | "failed" | "none"; label: string; url?: string };
export type LatestPosts = Map<string, Partial<Record<Platform, PostRow>>>;

export const PF: Record<AnyPlatform, { short: string; name: string; cls: string }> = {
  youtube: { short: "YT", name: "YouTube", cls: "yt" },
  tiktok: { short: "TT", name: "TikTok", cls: "tt" },
  instagram: { short: "IG", name: "Instagram", cls: "ig" },
};

const POST_STATE: Record<PostRow["status"], PState["state"]> = {
  published: "live", drafted: "drafted", processing: "processing", failed: "failed",
};
const STATE_LABEL: Record<PState["state"], string> = {
  live: "Published", drafted: "In drafts", processing: "Posting…", failed: "Failed", none: "Not posted",
};

/** Where a clip stands on each platform (YouTube from the clip row, others from their latest post). */
export function platformStates(clip: ClipRow, latest?: Partial<Record<Platform, PostRow>>): Record<AnyPlatform, PState> {
  const fromPost = (p?: PostRow): PState => {
    if (!p) return { state: "none", label: STATE_LABEL.none };
    const state = POST_STATE[p.status];
    return { state, label: STATE_LABEL[state], url: p.url ?? undefined };
  };
  return {
    youtube: clip.youtube_id
      ? { state: "live", label: "Uploaded", url: `https://youtube.com/shorts/${clip.youtube_id}` }
      : { state: "none", label: STATE_LABEL.none },
    tiktok: fromPost(latest?.tiktok),
    instagram: fromPost(latest?.instagram),
  };
}

export const PfMark = (p: { pf: AnyPlatform; s: PState }) => (
  <span class={`pf ${p.s.state}`} title={`${PF[p.pf].name}: ${p.s.label}`}><Logo pf={p.pf} /></span>
);

export function ClipGrid(props: {
  clips: ClipRow[]; posts?: LatestPosts; metrics?: Map<string, ClipMetrics>; empty?: Child;
  channels?: ChannelRow[]; showChannel?: boolean;
}) {
  const chName = (id: string | null) => (id ? (props.channels?.find((x) => x.id === id)?.name ?? id) : null);
  if (props.clips.length === 0)
    return <div class="empty">{props.empty ?? <>No clips yet. <a href="/sources/new">Add a source</a> to get some.</>}</div>;
  return (
    <div class="grid">
      {props.clips.map((c) => {
        const st = platformStates(c, props.posts?.get(c.id));
        const odd = !["published", "uploaded", "rendered"].includes(c.stage);
        return (
          <a class="card" href={`/clips/${c.id}`} data-preview={c.video_key ? `/media/${c.video_key}` : undefined}>
            <div class="thumb">
              {c.thumb_key ? <img loading="lazy" src={`/media/${c.thumb_key}`} alt="" /> : <div class="ph">{c.stage}</div>}
              <span class="tl ov score">{Math.round(c.score ?? 0)}</span>
              {total(props.metrics?.get(c.id), "views") != null ? (
                <span class="ov" style="position:absolute;top:8px;right:8px;z-index:2" title="Total views">▶ {compact(total(props.metrics?.get(c.id), "views"))}</span>
              ) : null}
              {c.duration ? <span class="br ov">{Math.round(c.duration)}s</span> : null}
              <span class="bl">{(["youtube", "tiktok", "instagram"] as const).map((pf) => <PfMark pf={pf} s={st[pf]} />)}</span>
            </div>
            <div class="meta">
              <span class="t">{c.title ?? c.id}</span>
              <span class="row">
                <Pill v={c.review} />
                {odd ? <Pill v={c.stage} /> : null}
                {props.showChannel !== false && props.channels ? (
                  c.channel_id ? <span class="chip" title="Channel">{chName(c.channel_id)}</span> : <span class="chip dim">unassigned</span>
                ) : null}
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export type ClipFilter = { review: string; notOn: string; source: string; sort: string };

export function ClipToolbar(props: { f: ClipFilter; sources: string[]; count: number }) {
  const { f } = props;
  const href = (patch: Partial<ClipFilter>) => {
    const q = new URLSearchParams(Object.entries({ ...f, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };
  const seg = (key: keyof ClipFilter, opts: [string, string][]) => (
    <div class="seg">
      {opts.map(([v, label]) => <a class={f[key] === v ? "on" : undefined} href={href({ [key]: v })}>{label}</a>)}
    </div>
  );
  return (
    <>
      <div class="toolbar">
        {seg("review", [["", "All"], ["pending", "To review"], ["approved", "Approved"], ["rejected", "Rejected"]])}
        {seg("notOn", [["", "Any"], ["youtube", "Not on YouTube"], ["tiktok", "Not on TikTok"], ["instagram", "Not on Instagram"]])}
      </div>
      <form class="toolbar" method="get" action="/">
        {f.review ? <input type="hidden" name="review" value={f.review} /> : null}
        {f.notOn ? <input type="hidden" name="notOn" value={f.notOn} /> : null}
        <select name="source" onchange="this.form.submit()" aria-label="Source">
          <option value="">All sources</option>
          {props.sources.map((s) => <option value={s} selected={f.source === s}>{s}</option>)}
        </select>
        <select name="sort" onchange="this.form.submit()" aria-label="Sort">
          <option value="" selected={!f.sort}>Newest first</option>
          <option value="score" selected={f.sort === "score"}>Highest score</option>
        </select>
        <noscript><button class="sm">Apply</button></noscript>
        <span class="muted small right">{props.count} clip{props.count === 1 ? "" : "s"}</span>
      </form>
    </>
  );
}

export function ClipPage(props: {
  clip: ClipRow;
  credit: string | null;
  flash?: string;
  states: Record<AnyPlatform, PState>;
  metrics?: ClipMetrics;
  channel: { current: ChannelRow | null; all: ChannelRow[]; locked: boolean };
  nav: { prev?: string; next?: string; index: number; total: number };
  defaultTab: string;
  panels: { youtube: Child; tiktok: Child; instagram: Child };
}) {
  const c = props.clip;
  const tags: string[] = JSON.parse(c.tags || "[]");
  return (
    <>
      <div class="row" style="justify-content:space-between">
        <a class="crumb" href={`/sources/${c.source_id}`}>← {c.source_id}</a>
        <div class="pager">
          {props.nav.prev ? <a class="btn sm ghost" href={`/clips/${props.nav.prev}`} title="Previous clip">‹ Prev</a> : null}
          <span class="muted small">{props.nav.index} / {props.nav.total}</span>
          {props.nav.next ? <a class="btn sm ghost" href={`/clips/${props.nav.next}`} title="Next clip">Next ›</a> : null}
        </div>
      </div>
      <Flash msg={props.flash} />
      <div class="detail">
        <div class="side">
          {c.video_key ? (
            <video class="player" controls preload="metadata" playsinline src={`/media/${c.video_key}`} poster={c.thumb_key ? `/media/${c.thumb_key}` : undefined} />
          ) : (
            <div class="card"><div class="thumb"><div class="ph">Not rendered yet ({c.stage})</div></div></div>
          )}
          <div class="row" style="margin-top:10px">
            {c.video_key ? <a class="btn sm" href={`/media/${c.video_key}?download=1`}>Download</a> : null}
            {(["youtube", "tiktok", "instagram"] as const).map((pf) =>
              props.states[pf].url ? <a class="btn sm" href={props.states[pf].url} target="_blank" rel="noopener"><Logo pf={pf} /> {PF[pf].name} ↗</a> : null,
            )}
          </div>
        </div>
        <div>
          <h1>{c.title ?? c.id}</h1>
          <div class="row" style="margin-top:8px">
            <span class="score" style="color:var(--accent)">{Math.round(c.score ?? 0)}</span>
            <Pill v={c.review} />
            {!["published", "uploaded", "rendered"].includes(c.stage) ? <Pill v={c.stage} /> : null}
            <span class="muted small">
              {c.duration ? `${Math.round(c.duration)}s · ` : ""}source {c.start.toFixed(1)}–{c.end.toFixed(1)}s{c.layout ? ` · ${c.layout} layout` : ""}
            </span>
          </div>

          <ChannelBox clipId={c.id} {...props.channel} />

          <div class="status">
            {(["youtube", "tiktok", "instagram"] as const).map((pf) => {
              const s = props.states[pf];
              return (
                <a class="tile" href={`#${pf}`} onclick={`document.querySelector('[data-tab=${pf}]').click();return false`}>
                  <b>{PF[pf].name}</b>
                  <span class="row"><PfMark pf={pf} s={s} /> {s.label}</span>
                  {s.state === "live" ? <StatLine m={props.metrics?.[pf]} /> : null}
                </a>
              );
            })}
          </div>

          {c.error ? <div class="err" style="margin-bottom:12px">{c.error}</div> : null}

          <div class="tabs" role="tablist" data-tabs={props.defaultTab}>
            <button type="button" role="tab" data-tab="details">Details</button>
            {(["youtube", "tiktok", "instagram"] as const).map((pf) => (
              <button type="button" role="tab" data-tab={pf}><Logo pf={pf} /> {PF[pf].name}</button>
            ))}
          </div>

          <section data-panel="details">
            {c.reason ? <p class="callout" style="margin:0 0 16px"><b style="color:var(--text)">Why this moment:</b> {c.reason}</p> : null}
            <form class="stack" method="post" action={`/clips/${c.id}`}>
              <label>
                Title
                <input name="title" maxlength={100} value={c.title ?? ""} data-count="100" />
                <span class="field-foot"><span>Used as the YouTube title and the first caption line.</span><span class="count" /></span>
              </label>
              <label>
                Description
                <textarea name="description" data-count="5000">{c.description ?? ""}</textarea>
                <span class="field-foot"><span /><span class="count" /></span>
              </label>
              <label>
                Tags
                <input name="tags" value={tags.join(", ")} placeholder="comma, separated" />
                <span class="field-foot"><span>Become hashtags in auto captions.</span></span>
              </label>
              {props.credit ? <p class="muted small" style="margin:0">Credit added automatically: “{props.credit}”</p> : null}
              <div class="row">
                <button type="submit" name="review" value="approved" class="primary">Save &amp; approve</button>
                <button type="submit" name="review" value={c.review}>Save</button>
                <button type="submit" name="review" value="rejected" class="danger ghost">Reject</button>
              </div>
            </form>
          </section>
          <section data-panel="youtube" id="youtube">{props.panels.youtube}</section>
          <section data-panel="tiktok" id="tiktok">{props.panels.tiktok}</section>
          <section data-panel="instagram" id="instagram">{props.panels.instagram}</section>
        </div>
      </div>
    </>
  );
}

/** Which channel the clip belongs to. Unassigned clips get a picker; it locks once the clip has gone out. */
function ChannelBox(props: { clipId: string; current: ChannelRow | null; all: ChannelRow[]; locked: boolean }) {
  const picker = (label: string) => (
    <form method="post" action={`/clips/${props.clipId}/channel`} class="row" style="flex-wrap:nowrap">
      <select name="channel_id" style="width:auto;min-width:180px">
        <option value="" selected={!props.current}>— Unassigned —</option>
        {props.all.map((ch) => <option value={ch.id} selected={props.current?.id === ch.id}>{ch.name}{ch.niche ? ` · ${ch.niche}` : ""}</option>)}
      </select>
      <button type="submit" class="sm primary">{label}</button>
    </form>
  );
  if (!props.current)
    return (
      <div class="callout" style="margin:16px 0 0;display:flex;flex-direction:column;gap:10px">
        <span><b style="color:var(--text)">Not assigned to a channel yet.</b> Pick the channel this clip fits; it will then show and post only there.</span>
        {props.all.length ? picker("Assign") : <span>No channels yet: <a href="/channels">create one</a>.</span>}
      </div>
    );
  return (
    <div class="row" style="margin-top:14px;gap:10px">
      <span class="muted small">Channel</span>
      <span class="chip strong">{props.current.name}</span>
      {props.locked ? (
        <span class="muted small" title="Posts and stats stay with the account this clip went out on">🔒 locked: already published</span>
      ) : (
        <details class="inline">
          <summary class="muted small">change</summary>
          <div style="margin-top:8px">{picker("Move")}</div>
        </details>
      )}
    </div>
  );
}
