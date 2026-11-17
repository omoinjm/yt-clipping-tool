import { Flash } from "./Layout";

export function UsersPage(props: { me: string; users: string[] | null; error?: string; configured: boolean; flash?: string }) {
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Users</h1>
          <p class="sub" style="margin:4px 0 0">People who can sign in to this dashboard. Everyone here has full access.</p>
        </div>
      </div>
      <Flash msg={props.flash} />
      {!props.configured ? (
        <div class="empty" style="text-align:left">
          User management isn't set up yet: set <code>CF_API_TOKEN</code>, <code>CF_ACCOUNT_ID</code> and <code>CF_ACCESS_GROUP_ID</code> on the Worker
          (see README → Dashboard users). Until then, manage sign-ins in Cloudflare Zero Trust → Access.
        </div>
      ) : props.error ? (
        <div class="err">{props.error}</div>
      ) : (
        <>
          <form method="post" action="/users/add" class="panel row" style="flex-wrap:nowrap">
            <input name="email" type="email" required placeholder="name@example.com" autocomplete="off" />
            <button class="primary" type="submit">Add user</button>
          </form>
          <p class="muted small" style="margin:8px 2px 0">
            They sign in at this dashboard's address with that email (Cloudflare sends them a one-time code). There's no invite email: share the link with them.
          </p>
          <div class="src-list" style="margin-top:16px">
            {(props.users ?? []).map((u) => (
              <div class="panel row" style="justify-content:space-between;padding:12px 16px">
                <span class="row" style="gap:10px">
                  <span class="pf" style="width:30px;height:30px;border-radius:50%;font-weight:700;font-size:13px">{u[0]?.toUpperCase()}</span>
                  <span>{u}{u.toLowerCase() === props.me.toLowerCase() ? <span class="muted small"> · you</span> : null}</span>
                </span>
                {u.toLowerCase() === props.me.toLowerCase() || (props.users ?? []).length <= 1 ? (
                  <span class="muted small">can't remove yourself</span>
                ) : (
                  <form method="post" action="/users/remove">
                    <input type="hidden" name="email" value={u} />
                    <button class="sm danger ghost" type="submit" data-confirm-title={`Remove ${u}?`} data-confirm-ok="Remove"
                      data-confirm="They're signed out right away and can't sign in again unless you add them back.">Remove</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
