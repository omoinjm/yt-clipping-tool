import type { ClipRow } from "../db";
import { CAPTION_MAX } from "../social/captions";
import type { PostRow } from "../social/posts";
import type { CreatorInfo } from "../social/tiktok";
import type { AccountPlatform } from "../social/tokens";
import { buildDescription } from "../youtube";
import { PF } from "./Clips";
import { Flash, Pill } from "./Layout";

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

type Caption = { text: string; custom: boolean };

export function AccountsPage(props: {
  accounts: Partial<Record<AccountPlatform, string>>;
  configured: Record<AccountPlatform, boolean>;
  flash?: string;
}) {
  const HELP: Record<AccountPlatform, string> = {
    youtube: "Shorts uploads. For a brand channel, pick it on Google's account chooser.",
    tiktok: "Send to drafts, or post directly (private until TikTok audits the app).",
    instagram: "Reels on a Business or Creator account in your Meta business portfolio.",
  };
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Accounts</h1>
          <p class="sub" style="margin:4px 0 0">Where clips get published. Logins are stored encrypted.</p>
        </div>
      </div>
      <Flash msg={props.flash} />
      <div class="src-list">
        {(["youtube", "tiktok", "instagram"] as const).map((p) => (
          <div class="panel row" style="justify-content:space-between;gap:16px">
            <div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0">
              <span class={`pf ${PF[p].cls} ${props.accounts[p] ? "live" : "none"}`} style="font-size:12px;padding:6px 9px">{PF[p].short}</span>
              <div style="min-width:0">
                <b>{PF[p].name}</b>
                <div class="muted small">{HELP[p]}</div>
              </div>
            </div>
            <div class="row" style="gap:12px">
              {props.accounts[p] ? <Pill v="published" label={props.accounts[p]!} /> : <Pill v="none" label="Not connected" />}
              {!props.configured[p] ? (
                <span class="muted small">App keys not set on the Worker</span>
              ) : props.accounts[p] ? (
                <form method="post" action={`/accounts/${p}/disconnect`} class="row">
                  <a class="btn sm" href={`/oauth/${p}/start`}>Reconnect</a>
                  <button class="sm danger ghost" type="submit" data-confirm={`Disconnect ${PF[p].name}?`}>Disconnect</button>
                </form>
              ) : (
                <a class="btn primary sm" href={`/oauth/${p}/start`}>Connect {PF[p].name}</a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PostHistory(props: { posts: PostRow[] }) {
  if (props.posts.length === 0) return null;
  return (
    <>
      <h3 style="margin-top:22px">History</h3>
      <ul class="posts">
        {props.posts.map((p) => (
          <li>
            <Pill v={p.status} />
            <span class="muted">{p.created_at} UTC · {p.mode === "draft" ? "drafts" : p.mode}{p.privacy ? ` · ${PRIVACY_LABEL[p.privacy] ?? p.privacy}` : ""}</span>
            {p.url ? <a class="btn sm right" href={p.url} target="_blank" rel="noopener">Open ↗</a> : null}
            {p.status === "drafted" ? <span class="muted small" style="width:100%">Open it from TikTok → Inbox → System notifications, then paste the caption.</span> : null}
            {p.status === "processing" ? <span class="muted small">checking every minute…</span> : null}
            {p.error ? <div class="err">{p.error}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function CaptionField(props: { id: string; caption: Caption }) {
  return (
    <label>
      <span class="row" style="justify-content:space-between">
        <span>Caption</span>
        <span class="row" style="gap:6px">
          <span class="muted small" style="font-weight:400">{props.caption.custom ? "Your caption" : "Auto caption"}</span>
          <button type="button" class="sm" data-copy={`#${props.id}`}>Copy</button>
        </span>
      </span>
      <textarea id={props.id} name="caption" maxlength={CAPTION_MAX} data-count={String(CAPTION_MAX)}>{props.caption.text}</textarea>
      <span class="field-foot"><span>Built from the title, description, tags and credit. Edit freely.</span><span class="count" /></span>
    </label>
  );
}

const CaptionButtons = (props: { custom: boolean }) => (
  <>
    <button type="submit" name="action" value="save" formnovalidate>Save caption</button>
    {props.custom ? <button type="submit" name="action" value="reset" formnovalidate class="ghost">Use auto caption</button> : null}
  </>
);

const NotConnected = (p: { name: string }) => (
  <div class="empty">{p.name} isn't connected. <a href="/accounts">Connect it on Accounts</a>.</div>
);

export function YouTubePanel(props: { clip: ClipRow; channel: string | null; credit: string | null }) {
  const c = props.clip;
  if (c.youtube_id)
    return (
      <div class="panel">
        <p style="margin:0 0 10px">Uploaded as <code>{c.youtube_id}</code>. Publish or schedule it from YouTube Studio.</p>
        <div class="row">
          <a class="btn sm" href={`https://youtube.com/shorts/${c.youtube_id}`} target="_blank" rel="noopener">Open Short ↗</a>
          <a class="btn sm" href={`https://studio.youtube.com/video/${c.youtube_id}/edit`} target="_blank" rel="noopener">Open in Studio ↗</a>
        </div>
      </div>
    );
  if (!props.channel) return <NotConnected name="YouTube" />;
  const tags: string[] = JSON.parse(c.tags || "[]");
  return (
    <form method="post" action={`/clips/${c.id}/youtube`} class="stack">
      <p class="muted" style="margin:0">Uploading to <b style="color:var(--text)">{props.channel}</b></p>
      <div class="panel">
        <h3>{(c.title ?? c.id).slice(0, 100)}</h3>
        <p class="muted small" style="white-space:pre-wrap;margin:0">{buildDescription(c.description ?? "", props.credit, tags)}</p>
        <p class="muted small" style="margin:10px 0 0">Edit the title, description and tags on the Details tab.</p>
      </div>
      <div class="row">
        <select name="privacy" style="width:auto">
          <option value="private">Private (draft)</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>
        <button type="submit" class="primary" disabled={!c.video_key}>Upload to YouTube</button>
      </div>
    </form>
  );
}

export function TikTokPanel(props: {
  clip: ClipRow;
  account?: string;
  caption: Caption;
  posts: PostRow[];
  creator: CreatorInfo | null;
  creatorError?: string;
}) {
  const c = props.clip;
  if (!props.account) return <NotConnected name="TikTok" />;
  const busy = props.posts.some((x) => x.status === "processing");
  const tooLong = props.creator && c.duration && c.duration > props.creator.max_video_post_duration_sec;
  return (
    <>
      <form class="stack" method="post" action={`/clips/${c.id}/social/tiktok`}>
        <p class="muted" style="margin:0">
          Posting as <b style="color:var(--text)">{props.creator ? `${props.creator.creator_nickname} (@${props.creator.creator_username})` : props.account}</b>
        </p>
        {props.creatorError ? <div class="err">{props.creatorError}</div> : null}
        <CaptionField id="cap-tiktok" caption={props.caption} />
        <div class="panel" style="display:flex;flex-direction:column;gap:12px">
          <label class="check"><input type="radio" name="mode" value="draft" checked /> <span><b>Send to TikTok drafts</b> <span class="muted">· arrives in your TikTok inbox; paste the caption there</span></span></label>
          <label class="check"><input type="radio" name="mode" value="direct" /> <span><b>Post now</b> <span class="muted">· needs a private account until TikTok audits this app</span></span></label>
          <div data-when="mode=direct" style="display:flex;flex-direction:column;gap:12px">
            <label>
              Who can view this video
              {/* TikTok's guidelines: show the account's own options, with no preselected default. */}
              <select name="privacy">
                <option value="">Choose…</option>
                {(props.creator?.privacy_level_options ?? []).map((o) => <option value={o}>{PRIVACY_LABEL[o] ?? o}</option>)}
              </select>
            </label>
            <div class="row" style="gap:16px">
              {(["comments", "duet", "stitch"] as const).map((k) => {
                const off = props.creator?.[`${k === "comments" ? "comment" : k}_disabled` as "comment_disabled"];
                return <label class="check"><input type="checkbox" name={`allow_${k}`} value="1" checked={!off} disabled={!!off} /> Allow {k}</label>;
              })}
            </div>
          </div>
        </div>
        {tooLong ? <div class="err">This clip is {Math.round(c.duration!)}s; this account can post up to {props.creator!.max_video_post_duration_sec}s.</div> : null}
        <div class="row">
          <button type="submit" name="action" value="post" class="primary" disabled={!c.video_key || busy || !!tooLong}>
            {busy ? "Posting…" : "Post to TikTok"}
          </button>
          <CaptionButtons custom={props.caption.custom} />
        </div>
        <p class="muted small" style="margin:0">
          By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.
        </p>
      </form>
      <PostHistory posts={props.posts} />
    </>
  );
}

export function InstagramPanel(props: { clip: ClipRow; account?: string; caption: Caption; posts: PostRow[] }) {
  const c = props.clip;
  if (!props.account) return <NotConnected name="Instagram" />;
  const busy = props.posts.some((x) => x.status === "processing");
  return (
    <>
      <form class="stack" method="post" action={`/clips/${c.id}/social/instagram`}>
        <p class="muted" style="margin:0">Posting as <b style="color:var(--text)">@{props.account}</b> · Reel · goes live immediately</p>
        <CaptionField id="cap-instagram" caption={props.caption} />
        <label class="check"><input type="checkbox" name="share_to_feed" value="1" checked /> Also show in the profile grid</label>
        <div class="row">
          <button type="submit" name="action" value="post" class="primary" disabled={!c.video_key || busy}
            data-confirm={`This publishes the Reel publicly on @${props.account} right away. Continue?`}>
            {busy ? "Posting…" : "Post to Instagram"}
          </button>
          <CaptionButtons custom={props.caption.custom} />
        </div>
      </form>
      <PostHistory posts={props.posts} />
    </>
  );
}
