import type { ChannelRow } from "../channels";
import type { HeaderStyleRow } from "../headers";
import type { AccountNames, AccountPlatform } from "../social/tokens";
import { PF } from "./Clips";
import { Flash, Pill } from "./Layout";
import { Logo } from "./Logos";

const PLATFORMS: AccountPlatform[] = ["youtube", "tiktok", "instagram"];

/** What each platform needs before a NEW account can connect (the apps are in test/sandbox mode). */
const HINT: Record<AccountPlatform, string> = {
  youtube: "Sign in with the Google account that manages the channel, then pick that channel on Google's chooser.",
  tiktok: "The TikTok account must be a Sandbox target user of the app (TikTok developer portal → Sandbox settings).",
  instagram: "The Instagram account must be Business/Creator, in the njmtech business portfolio, and an Instagram tester on the Meta app.",
};

function ChannelCard(props: { ch: ChannelRow; accounts: AccountNames; configured: Record<AccountPlatform, boolean>; styles: HeaderStyleRow[] }) {
  const { ch } = props;
  return (
    <section class="panel" id={`ch-${ch.id}`} style="display:flex;flex-direction:column;gap:14px">
      <div class="row" style="justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <h3 style="margin:0;font-size:16px">{ch.name}</h3>
          <div class="muted small">
            {ch.niche || "No niche set"} · {ch.clip_count ?? 0} clip{ch.clip_count === 1 ? "" : "s"}
            {ch.hashtags ? ` · adds ${ch.hashtags}` : ""}
          </div>
          {ch.twitch_url || ch.kick_url ? (
            <div class="row small" style="gap:10px;margin-top:4px">
              {ch.twitch_url ? <a class="row" style="gap:4px" href={ch.twitch_url} target="_blank" rel="noopener"><Logo pf="twitch" size={13} /> Twitch</a> : null}
              {ch.kick_url ? <a class="row" style="gap:4px" href={ch.kick_url} target="_blank" rel="noopener"><Logo pf="kick" size={13} /> Kick</a> : null}
            </div>
          ) : null}
        </div>
        <form method="post" action="/scope">
          <input type="hidden" name="scope" value={ch.id} />
          <input type="hidden" name="to" value="/" />
          <button class="sm" type="submit">View clips →</button>
        </form>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px">
        {PLATFORMS.map((p) => {
          const name = props.accounts[p];
          return (
            <div class="row" style="justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px">
              <div class="row" style="gap:10px;flex-wrap:nowrap;min-width:0">
                <span class={`pf ${name ? "live" : "none"}`}><Logo pf={p} /></span>
                <div style="min-width:0">
                  <b style="font-size:13.5px">{PF[p].name}</b>
                  {!name ? <div class="muted small">{HINT[p]}</div> : null}
                </div>
              </div>
              <div class="row" style="gap:8px">
                {name ? <Pill v="published" label={name} /> : null}
                {!props.configured[p] ? (
                  <span class="muted small">App keys not set on the Worker</span>
                ) : name ? (
                  <form method="post" action={`/channels/${ch.id}/disconnect/${p}`} class="row">
                    <a class="btn sm" href={`/oauth/${p}/start?channel=${ch.id}`}>Reconnect</a>
                    <button class="sm danger ghost" type="submit" data-confirm-title={`Disconnect ${PF[p].name}?`} data-confirm-ok="Disconnect"
                      data-confirm={`“${ch.name}” will stop posting to ${name} on ${PF[p].name}. You can connect it again any time.`}>Disconnect</button>
                  </form>
                ) : (
                  <a class="btn primary sm" href={`/oauth/${p}/start?channel=${ch.id}`}>Connect</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <details class="inline">
        <summary class="muted small">Edit channel</summary>
        <form method="post" action={`/channels/${ch.id}`} class="stack" style="margin-top:12px">
          <div class="row" style="gap:12px;align-items:flex-start">
            <label style="flex:1;min-width:180px">Name<input name="name" value={ch.name} maxlength={60} required /></label>
            <label style="flex:1;min-width:180px">Niche<input name="niche" value={ch.niche ?? ""} maxlength={120} placeholder="e.g. Gaming, Business podcasts" /></label>
          </div>
          <label>
            Default hashtags
            <input name="hashtags" value={ch.hashtags} placeholder="#gaming #gta6" />
            <span class="field-foot"><span>Added to this channel's auto captions after each clip's own hashtags (max 10).</span></span>
          </label>
          <label>
            Header style
            <select name="header_style_id">
              <option value="" selected={!ch.header_style_id}>Global default</option>
              {props.styles.map((s) => <option value={s.id} selected={ch.header_style_id === s.id}>{s.name}</option>)}
            </select>
            <span class="field-foot"><span>The header this channel's clips render with (clips can override it). <a href="/headers">Manage styles</a></span></span>
          </label>
          <div class="row" style="gap:12px;align-items:flex-start">
            <label style="flex:1;min-width:180px">
              <span class="row" style="gap:6px"><Logo pf="twitch" size={14} /> Twitch channel page <span style="font-weight:400">(optional)</span></span>
              <input name="twitch_url" value={ch.twitch_url ?? ""} placeholder="https://www.twitch.tv/yourchannel" />
            </label>
            <label style="flex:1;min-width:180px">
              <span class="row" style="gap:6px"><Logo pf="kick" size={14} /> Kick channel page <span style="font-weight:400">(optional)</span></span>
              <input name="kick_url" value={ch.kick_url ?? ""} placeholder="https://kick.com/yourchannel" />
            </label>
          </div>
          <span class="muted small" style="margin-top:-6px">Long-form videos are uploaded to Twitch/Kick by hand; these give direct links on each video's page.</span>
          <div class="row">
            <button class="primary sm" type="submit">Save</button>
            <button class="sm danger ghost" type="submit" formaction={`/channels/${ch.id}/delete`} formnovalidate
              data-confirm-title={`Delete “${ch.name}”?`} data-confirm-ok="Delete channel"
              data-confirm="Its account connections are removed and its clips go back to unassigned. Not possible while it has published clips.">Delete channel</button>
          </div>
        </form>
      </details>
    </section>
  );
}

export function ChannelsPage(props: {
  channels: ChannelRow[];
  accounts: Map<string, AccountNames>;
  configured: Record<AccountPlatform, boolean>;
  styles: HeaderStyleRow[];
  flash?: string;
}) {
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Channels</h1>
          <p class="sub" style="margin:4px 0 0">
            One per niche. Each has its own YouTube, TikTok and Instagram accounts; finished clips are assigned to a channel and post only there.
          </p>
        </div>
      </div>
      <Flash msg={props.flash} />
      <div class="src-list">
        {props.channels.map((ch) => <ChannelCard ch={ch} accounts={props.accounts.get(ch.id) ?? {}} configured={props.configured} styles={props.styles} />)}
      </div>

      <h2>New channel</h2>
      <form method="post" action="/channels" class="panel stack">
        <div class="row" style="gap:12px;align-items:flex-start">
          <label style="flex:1;min-width:180px">Name<input name="name" maxlength={60} required placeholder="e.g. Shukela Business" /></label>
          <label style="flex:1;min-width:180px">Niche<input name="niche" maxlength={120} placeholder="e.g. Business podcasts" /></label>
        </div>
        <label>
          <span>Default hashtags <span style="font-weight:400">(optional)</span></span>
          <input name="hashtags" placeholder="#business #startups" />
        </label>
        <label>
          Header style
          <select name="header_style_id">
            <option value="" selected>Global default</option>
            {props.styles.map((s) => <option value={s.id}>{s.name}</option>)}
          </select>
          <span class="field-foot"><span>The header this channel's clips render with (clips can override it). <a href="/headers">Manage styles</a></span></span>
        </label>
          <div class="row" style="gap:12px;align-items:flex-start">
            <label style="flex:1;min-width:180px">
              <span class="row" style="gap:6px"><Logo pf="twitch" size={14} /> Twitch channel page <span style="font-weight:400">(optional)</span></span>
              <input name="twitch_url" value={""} placeholder="https://www.twitch.tv/yourchannel" />
            </label>
            <label style="flex:1;min-width:180px">
              <span class="row" style="gap:6px"><Logo pf="kick" size={14} /> Kick channel page <span style="font-weight:400">(optional)</span></span>
              <input name="kick_url" value={""} placeholder="https://kick.com/yourchannel" />
            </label>
          </div>
          <span class="muted small" style="margin-top:-6px">Long-form videos are uploaded to Twitch/Kick by hand; these give direct links on each video's page.</span>
        <div class="row"><button class="primary" type="submit">Create channel</button><span class="muted small">Then connect its accounts.</span></div>
      </form>
    </>
  );
}
