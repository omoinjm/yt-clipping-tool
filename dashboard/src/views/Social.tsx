import type { ClipRow } from "../db";
import { CAPTION_MAX } from "../social/captions";
import type { PostRow } from "../social/posts";
import type { CreatorInfo } from "../social/tiktok";
import type { AccountPlatform, Platform } from "../social/tokens";
import { Pill } from "./Layout";

const NAME: Record<AccountPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export function AccountsPage(props: {
  accounts: Partial<Record<AccountPlatform, string>>;
  configured: Record<AccountPlatform, boolean>;
  flash?: string;
}) {
  const row = (p: AccountPlatform, help: string) => (
    <tr>
      <td><b>{NAME[p]}</b><div class="muted" style="font-size:12px">{help}</div></td>
      <td>
        {props.accounts[p] ? <>Connected as <b>{props.accounts[p]}</b></> : <span class="muted">Not connected</span>}
      </td>
      <td style="text-align:right">
        {!props.configured[p] ? (
          <span class="muted" style="font-size:12px">App keys not set on the Worker (see README)</span>
        ) : props.accounts[p] ? (
          <form method="post" action={`/accounts/${p}/disconnect`} class="row" style="justify-content:flex-end">
            <a class="btn" href={`/oauth/${p}/start`}>Reconnect</a>
            <button class="danger" type="submit">Disconnect</button>
          </form>
        ) : (
          <a class="btn primary" style="background:var(--accent);color:#111" href={`/oauth/${p}/start`}>Connect {NAME[p]}</a>
        )}
      </td>
    </tr>
  );
  return (
    <>
      <h1>Accounts</h1>
      {props.flash ? <div class="flash">{props.flash}</div> : null}
      <table>
        <tbody>
          {row("youtube", "Shorts uploads. For a brand channel, pick it on Google's account chooser")}
          {row("tiktok", "Direct post (private until TikTok audits the app) or send to your TikTok drafts")}
          {row("instagram", "Reels on an Instagram Business or Creator account")}
        </tbody>
      </table>
    </>
  );
}

function PostHistory(props: { posts: PostRow[] }) {
  if (props.posts.length === 0) return null;
  return (
    <ul class="posts">
      {props.posts.map((p) => (
        <li>
          <Pill v={p.status} /> <span class="muted">{p.created_at} · {p.mode}{p.privacy ? ` · ${PRIVACY_LABEL[p.privacy] ?? p.privacy}` : ""}</span>
          {p.url ? <> · <a href={p.url} target="_blank">open ↗</a></> : null}
          {p.status === "drafted" ? <span class="muted"> · finish it from the notification in the TikTok app</span> : null}
          {p.status === "processing" ? <span class="muted"> · checking every minute</span> : null}
          {p.error ? <div class="err" style="margin-top:4px">{p.error}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function CaptionField(props: { platform: Platform; caption: { text: string; custom: boolean } }) {
  return (
    <label>
      <span class="row" style="justify-content:space-between">
        <span>Caption</span>
        <span class="muted" style="font-size:12px">
          {props.caption.custom ? "your caption" : "auto: from the title, description, tags and credit"}
        </span>
      </span>
      <textarea name="caption" maxlength={CAPTION_MAX}>{props.caption.text}</textarea>
    </label>
  );
}

const CaptionButtons = (props: { custom: boolean }) => (
  <>
    <button type="submit" name="action" value="save" formnovalidate>Save caption</button>
    {props.custom ? <button type="submit" name="action" value="reset" formnovalidate>Use auto caption</button> : null}
  </>
);

export function SocialSection(props: {
  clip: ClipRow;
  accounts: Partial<Record<AccountPlatform, string>>;
  captions: Record<Platform, { text: string; custom: boolean }>;
  posts: PostRow[];
  creator: CreatorInfo | null;
  creatorError?: string;
  credit: string | null;
}) {
  const c = props.clip;
  const forPlatform = (p: Platform) => props.posts.filter((x) => x.platform === p);
  const busy = (p: Platform) => forPlatform(p).some((x) => x.status === "processing");
  const tooLong = props.creator && c.duration && c.duration > props.creator.max_video_post_duration_sec;
  const notReady = !c.video_key;
  return (
    <>
      <h2>TikTok</h2>
      {!props.accounts.tiktok ? (
        <p class="muted">Not connected. <a href="/accounts">Connect TikTok</a></p>
      ) : (
        <form class="edit social" method="post" action={`/clips/${c.id}/social/tiktok`}>
          <p class="muted" style="margin:0">
            Posting as <b>{props.creator ? `${props.creator.creator_nickname} (@${props.creator.creator_username})` : props.accounts.tiktok}</b>
          </p>
          {props.creatorError ? <div class="err">{props.creatorError}</div> : null}
          <CaptionField platform="tiktok" caption={props.captions.tiktok} />
          <div class="row">
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="radio" name="mode" value="direct" checked /> Post now
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="radio" name="mode" value="draft" /> Send to TikTok drafts
            </label>
          </div>
          <label>
            Who can view this video (Post now)
            {/* TikTok's guidelines: show the account's own options, with no preselected default. */}
            <select name="privacy">
              <option value="">Choose…</option>
              {(props.creator?.privacy_level_options ?? []).map((o) => <option value={o}>{PRIVACY_LABEL[o] ?? o}</option>)}
            </select>
          </label>
          <div class="row">
            {(["comments", "duet", "stitch"] as const).map((k) => {
              const off = props.creator?.[`${k === "comments" ? "comment" : k}_disabled` as "comment_disabled"];
              return (
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" name={`allow_${k}`} value="1" checked={!off} disabled={!!off} /> Allow {k}
                </label>
              );
            })}
          </div>
          <p class="muted" style="font-size:12px;margin:0">
            Drafts don't carry the caption: paste it in the TikTok app. Until TikTok audits this app, “Post now” only works with “Only me”.
            By posting, you agree to TikTok's{" "}
            <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank">Music Usage Confirmation</a>.
          </p>
          {tooLong ? <div class="err">This clip is {Math.round(c.duration!)}s; this account can post up to {props.creator!.max_video_post_duration_sec}s.</div> : null}
          <div class="row">
            <button type="submit" name="action" value="post" class="primary" disabled={notReady || busy("tiktok") || !!tooLong}>
              {busy("tiktok") ? "Posting…" : "Post to TikTok"}
            </button>
            <CaptionButtons custom={props.captions.tiktok.custom} />
          </div>
          <PostHistory posts={forPlatform("tiktok")} />
        </form>
      )}

      <h2>Instagram</h2>
      {!props.accounts.instagram ? (
        <p class="muted">Not connected. <a href="/accounts">Connect Instagram</a></p>
      ) : (
        <form class="edit social" method="post" action={`/clips/${c.id}/social/instagram`}>
          <p class="muted" style="margin:0">Posting as <b>@{props.accounts.instagram}</b> · Reel</p>
          <CaptionField platform="instagram" caption={props.captions.instagram} />
          <label style="flex-direction:row;align-items:center;gap:6px">
            <input type="checkbox" name="share_to_feed" value="1" checked /> Also show in the profile grid
          </label>
          <div class="row">
            <button type="submit" name="action" value="post" class="primary" disabled={notReady || busy("instagram")}>
              {busy("instagram") ? "Posting…" : "Post to Instagram"}
            </button>
            <CaptionButtons custom={props.captions.instagram.custom} />
          </div>
          <PostHistory posts={forPlatform("instagram")} />
        </form>
      )}
      {props.credit ? <p class="muted" style="font-size:12px">The credit line (“{props.credit}”) is added back automatically if it's edited out of a caption.</p> : null}
    </>
  );
}
