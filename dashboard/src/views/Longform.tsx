import type { ChannelRow } from "../channels";
import type { LongformRow } from "../longform";
import type { MetricRow } from "../social/metrics";
import { fmtBytes } from "../submissions";
import { ChannelBox, PF, type LongPlatform, type PState } from "./Clips";
import { ago, Flash, Pill } from "./Layout";
import { Logo } from "./Logos";
import { StatLine } from "./Metrics";

type LongStats = Partial<Record<LongPlatform, MetricRow>>;
const LONG: LongPlatform[] = ["youtube", "twitch", "kick"];

export const fmtLength = (sec?: number | null) => {
  if (!sec) return "—";
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
};

export function longStates(lf: LongformRow): Record<LongPlatform, PState> {
  const pct = lf.size ? Math.floor((lf.yt_offset / lf.size) * 100) : 0;
  return {
    youtube:
      lf.yt_status === "uploaded" ? { state: "live", label: "Uploaded", url: `https://www.youtube.com/watch?v=${lf.yt_video_id}` }
      : lf.yt_status === "uploading" ? { state: "processing", label: `Uploading ${pct}%` }
      : lf.yt_status === "failed" ? { state: "failed", label: "Failed" }
      : { state: "none", label: "Not posted" },
    twitch: lf.twitch_url ? { state: "live", label: "Linked", url: lf.twitch_url } : { state: "none", label: "Not posted" },
    kick: lf.kick_url ? { state: "live", label: "Linked", url: lf.kick_url } : { state: "none", label: "Not posted" },
  };
}

const Mark = (p: { pf: LongPlatform; s: PState }) => (
  <span class={`pf ${p.s.state}`} title={`${PF[p.pf].name}: ${p.s.label}`}><Logo pf={p.pf} /></span>
);

export function VideoGrid(props: {
  items: LongformRow[]; channels: ChannelRow[]; showChannel: boolean; metrics: Map<string, LongStats>; empty: string;
}) {
  if (!props.items.length) return <div class="empty">{props.empty}</div>;
  const chName = (id: string | null) => (id ? (props.channels.find((x) => x.id === id)?.name ?? id) : null);
  return (
    <div class="grid wide">
      {props.items.map((lf) => {
        const st = longStates(lf);
        const views = Object.values(props.metrics.get(lf.source_id) ?? {}).reduce((a, r) => a + (r?.views ?? 0), 0);
        return (
          <a class="card" href={`/videos/${lf.source_id}`}>
            <div class="thumb wide">
              {lf.thumb_key ? <img loading="lazy" src={`/media/${lf.thumb_key}`} alt="" /> : <div class="ph">no thumbnail</div>}
              {views ? <span class="ov" style="position:absolute;top:8px;right:8px;z-index:2">▶ {views.toLocaleString()}</span> : null}
              <span class="br ov">{fmtLength(lf.duration)}</span>
              <span class="bl">{LONG.map((pf) => <Mark pf={pf} s={st[pf]} />)}</span>
            </div>
            <div class="meta">
              <span class="t">{lf.title || lf.source_id}</span>
              <span class="row">
                <span class="muted small">{fmtBytes(lf.size)}</span>
                {props.showChannel ? (lf.channel_id ? <span class="chip">{chName(lf.channel_id)}</span> : <span class="chip dim">unassigned</span>) : null}
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

const NeedsChannel = () => <div class="empty">Assign this video to a channel first (Details tab). It publishes with that channel's accounts.</div>;

function CopyBlock(props: { id: string; label: string; text: string; rows?: number }) {
  return (
    <label>
      <span class="row" style="justify-content:space-between"><span>{props.label}</span>
        <button type="button" class="sm" data-copy={`#${props.id}`}>Copy</button></span>
      <textarea id={props.id} readonly style={`min-height:${(props.rows ?? 2) * 22 + 20}px`}>{props.text}</textarea>
    </label>
  );
}

function ManualPanel(props: {
  pf: "twitch" | "kick"; lf: LongformRow; channel: ChannelRow | null; stats?: MetricRow; statsNote?: string;
}) {
  const { lf, pf } = props;
  const url = pf === "twitch" ? lf.twitch_url : lf.kick_url;
  const name = PF[pf].name;
  if (!props.channel) return <NeedsChannel />;
  if (url)
    return (
      <div class="panel" style="display:flex;flex-direction:column;gap:10px">
        <div class="row">
          <Pill v="published" label={`On ${name}`} />
          <a class="btn sm right" href={url} target="_blank" rel="noopener">Open ↗</a>
        </div>
        {pf === "twitch" ? (props.stats ? <StatLine m={props.stats} /> : <span class="muted small">{props.statsNote ?? "Views appear after the next stats refresh."}</span>)
          : <span class="muted small">Kick has no stats API, so only the link is kept.</span>}
        <form method="post" action={`/videos/${lf.source_id}/link/${pf}`} class="row">
          <input type="hidden" name="action" value="remove" />
          <button class="sm danger ghost" type="submit" data-confirm-title={`Remove the ${name} link?`} data-confirm-ok="Remove link"
            data-confirm={`This only forgets the link here; the video stays on ${name}.`}>Remove link</button>
          {pf === "twitch" ? <button class="sm ghost" formaction={`/videos/${lf.source_id}/metrics`} type="submit">Refresh stats</button> : null}
        </form>
      </div>
    );
  const page = pf === "twitch" ? props.channel.twitch_url : props.channel.kick_url;
  const login = page?.replace(/\/+$/, "").split("/").pop();
  const uploadUrl = pf === "twitch" && login ? `https://dashboard.twitch.tv/u/${login}/content/video-producer` : page;
  const tags: string[] = JSON.parse(lf.tags || "[]");
  return (
    <div class="stack">
      <p class="muted" style="margin:0">
        {name} has no upload API, so this one is by hand. The video stays linked to <b style="color:var(--text)">{props.channel.name}</b>.
      </p>
      <ol class="steps-list">
        <li>
          <a class="btn sm" href={`/media/${lf.video_key}?download=1`}><Logo pf={pf} /> Download full video</a>
          <span class="muted small"> {fmtBytes(lf.size)} · 1080p MP4</span>
        </li>
        <li>
          Upload it on {name}
          {uploadUrl ? <> · <a href={uploadUrl} target="_blank" rel="noopener">open {pf === "twitch" ? "Video Producer" : "your Kick channel"} ↗</a></>
            : <span class="muted small"> (add this channel's {name} page on <a href="/channels">Channels</a> for a direct link)</span>}
          {pf === "twitch" ? <div class="muted small">Twitch only lets Affiliates and Partners upload videos.</div> : null}
        </li>
        <li>
          Use this title and description:
          <div class="stack" style="margin-top:8px">
            <CopyBlock id={`${pf}-title`} label="Title" text={(lf.title || lf.source_id).slice(0, 140)} rows={1} />
            <CopyBlock id={`${pf}-desc`} label="Description" text={[lf.description, tags.length ? tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ") : ""].filter(Boolean).join("\n\n")} rows={4} />
          </div>
        </li>
        <li>
          Paste the video's link here:
          <form method="post" action={`/videos/${lf.source_id}/link/${pf}`} class="row" style="margin-top:8px;flex-wrap:nowrap">
            <input name="url" required placeholder={pf === "twitch" ? "https://www.twitch.tv/videos/123456789" : "https://kick.com/yourchannel/videos/…"} />
            <button class="primary" type="submit">Save link</button>
          </form>
        </li>
      </ol>
    </div>
  );
}

function YouTubeLongPanel(props: { lf: LongformRow; channel: ChannelRow | null; connected: string | null; stats?: MetricRow }) {
  const { lf } = props;
  if (lf.yt_status === "uploaded")
    return (
      <div class="panel" style="display:flex;flex-direction:column;gap:10px">
        <div class="row">
          <Pill v="published" label="Uploaded to YouTube" />
          <span class="muted small">{lf.yt_privacy} · since {ago(lf.updated_at)}</span>
          <a class="btn sm right" href={`https://www.youtube.com/watch?v=${lf.yt_video_id}`} target="_blank" rel="noopener">Open ↗</a>
          <a class="btn sm" href={`https://studio.youtube.com/video/${lf.yt_video_id}/edit`} target="_blank" rel="noopener">Studio ↗</a>
        </div>
        <StatLine m={props.stats} />
        <form method="post" action={`/videos/${lf.source_id}/metrics`}><button class="sm ghost">Refresh stats</button></form>
      </div>
    );
  if (lf.yt_status === "uploading") {
    const pct = lf.size ? Math.floor((lf.yt_offset / lf.size) * 100) : 0;
    const left = Math.max(1, Math.ceil((lf.size - lf.yt_offset) / (384 * 1024 * 1024)));
    return (
      <div class="panel" style="display:flex;flex-direction:column;gap:10px">
        <div class="row"><Pill v="processing" label={`Uploading ${pct}%`} />
          <span class="muted small">{fmtBytes(lf.yt_offset)} of {fmtBytes(lf.size)} · about {left} min left · runs in the background</span></div>
        <div class="bar" style="height:8px"><i style={`width:${pct}%`} /></div>
        {lf.yt_error ? <div class="err">Last attempt: {lf.yt_error} (retrying every minute)</div> : null}
      </div>
    );
  }
  if (!props.channel) return <NeedsChannel />;
  if (!props.connected)
    return <div class="empty">{props.channel.name} has no YouTube account connected. <a href="/channels">Connect one on Channels</a>.</div>;
  return (
    <form method="post" action={`/videos/${lf.source_id}/youtube`} class="stack">
      {lf.yt_status === "failed" ? <div class="err">Previous upload failed: {lf.yt_error}</div> : null}
      <p class="muted" style="margin:0">Uploading to <b style="color:var(--text)">{props.connected}</b> · {fmtBytes(lf.size)} · {fmtLength(lf.duration)}</p>
      <div class="panel">
        <h3>{(lf.title || lf.source_id).slice(0, 100)}</h3>
        <p class="muted small" style="white-space:pre-wrap;margin:0">{(lf.description || "").slice(0, 600) || "No description."}</p>
        <p class="muted small" style="margin:10px 0 0">Edit the title, description and tags on the Details tab.</p>
      </div>
      <div class="row">
        <select name="privacy" style="width:auto">
          <option value="private">Private (draft)</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>
        <button type="submit" class="primary">{lf.yt_status === "failed" ? "Try again" : "Upload full video"}</button>
        <span class="muted small">Large files upload in the background, about 384 MB a minute.</span>
      </div>
    </form>
  );
}

export function LongformPage(props: {
  lf: LongformRow; credit: string | null; flash?: string; youtubeAccount: string | null; twitchReady: boolean;
  channel: { current: ChannelRow | null; all: ChannelRow[]; locked: boolean }; stats: LongStats; defaultTab: string;
}) {
  const { lf } = props;
  const st = longStates(lf);
  const tags: string[] = JSON.parse(lf.tags || "[]");
  return (
    <>
      <div class="row" style="justify-content:space-between">
        <a class="crumb" href="/videos">← Videos</a>
        <a class="crumb" href={`/sources/${lf.source_id}`}>Source & clips →</a>
      </div>
      <Flash msg={props.flash} />
      <video class="player wide" controls preload="metadata" playsinline src={`/media/${lf.video_key}`} poster={lf.thumb_key ? `/media/${lf.thumb_key}` : undefined} />
      <div class="row" style="margin-top:12px;justify-content:space-between">
        <div style="min-width:0">
          <h1>{lf.title || lf.source_id}</h1>
          <div class="muted small" style="margin-top:6px">{fmtLength(lf.duration)} · {fmtBytes(lf.size)} · 1080p · kept since {ago(lf.created_at)}</div>
        </div>
        <a class="btn sm" href={`/media/${lf.video_key}?download=1`}>Download</a>
      </div>

      <ChannelBox action={`/videos/${lf.source_id}/channel`} what="video" {...props.channel} />

      <div class="status">
        {LONG.map((pf) => (
          <a class="tile" href={`#${pf}`} onclick={`document.querySelector('[data-tab=${pf}]').click();return false`}>
            <b>{PF[pf].name}</b>
            <span class="row"><Mark pf={pf} s={st[pf]} /> {st[pf].label}</span>
            {st[pf].state === "live" ? <StatLine m={props.stats[pf]} /> : null}
          </a>
        ))}
      </div>

      <div class="tabs" role="tablist" data-tabs={props.defaultTab}>
        <button type="button" role="tab" data-tab="details">Details</button>
        {LONG.map((pf) => <button type="button" role="tab" data-tab={pf}><Logo pf={pf} /> {PF[pf].name}</button>)}
      </div>

      <section data-panel="details">
        <form class="stack" method="post" action={`/videos/${lf.source_id}`}>
          <label>Title<input name="title" maxlength={100} value={lf.title ?? ""} data-count="100" />
            <span class="field-foot"><span>Used on YouTube, and as the copy-ready title for Twitch/Kick.</span><span class="count" /></span></label>
          <label>Description<textarea name="description" data-count="5000" style="min-height:160px">{lf.description ?? ""}</textarea>
            <span class="field-foot"><span /><span class="count" /></span></label>
          <label>Tags<input name="tags" value={tags.join(", ")} placeholder="comma, separated" /></label>
          {props.credit ? <p class="muted small" style="margin:0">Credit added on YouTube: “{props.credit}”</p> : null}
          <div class="row">
            <button type="submit" class="primary">Save</button>
            <button type="submit" class="danger ghost right" formaction={`/videos/${lf.source_id}/delete`} formnovalidate
              data-confirm-title="Delete the full video?" data-confirm-ok="Delete video"
              data-confirm={`Removes the ${fmtBytes(lf.size)} file from storage. Clips and anything already posted are not affected.`}>Delete full video</button>
          </div>
        </form>
      </section>
      <section data-panel="youtube" id="youtube">
        <YouTubeLongPanel lf={lf} channel={props.channel.current} connected={props.youtubeAccount} stats={props.stats.youtube} />
      </section>
      <section data-panel="twitch" id="twitch">
        <ManualPanel pf="twitch" lf={lf} channel={props.channel.current} stats={props.stats.twitch}
          statsNote={props.twitchReady ? undefined : "Views aren't tracked yet: Twitch app keys aren't set on the Worker."} />
      </section>
      <section data-panel="kick" id="kick">
        <ManualPanel pf="kick" lf={lf} channel={props.channel.current} />
      </section>
    </>
  );
}
