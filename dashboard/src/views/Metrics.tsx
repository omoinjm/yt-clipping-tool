import type { ClipRow } from "../db";
import { compact, total, type ClipMetrics, type MetricPlatform, type MetricRow } from "../social/metrics";
import { PF } from "./Clips";
import { ago, Flash } from "./Layout";

const PLATFORMS: MetricPlatform[] = ["youtube", "tiktok", "instagram"];

/** "1.2K views · 34 likes · 5 comments" for one platform. */
export function StatLine(props: { m?: MetricRow }) {
  const m = props.m;
  if (!m) return null;
  if (m.views == null && m.likes == null && m.comments == null)
    return m.error ? <span class="muted small" title={m.error}>stats unavailable</span> : null;
  return (
    <span class="muted small" title={m.error ? `Last refresh failed: ${m.error}` : `Updated ${ago(m.fetched_at)}`}>
      {[m.views != null ? `${compact(m.views)} views` : null, m.likes != null ? `${compact(m.likes)} likes` : null,
        m.comments != null ? `${compact(m.comments)} comments` : null].filter(Boolean).join(" · ")}
    </span>
  );
}

/** Why some numbers are missing, in plain words. */
function hints(rows: MetricRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.platform === "tiktok" && r.error && /scope|permission|unauthori[sz]ed|access_token/i.test(r.error))
      out.add("TikTok stats need the video.list scope: add it to the TikTok app, then Reconnect TikTok on Accounts.");
    else if (r.platform === "tiktok" && r.error) out.add(`TikTok: ${r.error}`);
    if (r.platform === "instagram" && !r.error && r.views == null)
      out.add("Instagram views need the instagram_manage_insights permission: add it to the Meta login configuration, then Reconnect Instagram.");
    if (r.platform === "instagram" && r.error) out.add(`Instagram: ${r.error}`);
    if (r.platform === "youtube" && r.error) out.add(`YouTube: ${r.error}`);
  }
  return [...out];
}

export function MetricsPage(props: { clips: ClipRow[]; metrics: Map<string, ClipMetrics>; flash?: string }) {
  const rows = [...props.metrics.values()].flatMap((m) => Object.values(m) as MetricRow[]);
  // undefined (shown as "—") when no post reports that number, so missing data never reads as zero.
  const sum = (k: "views" | "likes" | "comments" | "shares", pf?: MetricPlatform) => {
    const vals = rows.filter((r) => !pf || r.platform === pf).map((r) => r[k]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
  };
  const live = (pf?: MetricPlatform) => rows.filter((r) => !pf || r.platform === pf).length;
  const lastFetch = rows.map((r) => r.fetched_at).sort().at(-1);
  const ranked = props.clips
    .filter((c) => props.metrics.has(c.id))
    .map((c) => ({ c, m: props.metrics.get(c.id)!, views: total(props.metrics.get(c.id), "views") ?? 0 }))
    .sort((a, b) => b.views - a.views || (total(b.m, "likes") ?? 0) - (total(a.m, "likes") ?? 0));
  const maxViews = Math.max(1, ...ranked.map((r) => r.views));
  const notes = hints(rows);

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Metrics</h1>
          <p class="sub" style="margin:4px 0 0">
            Performance of published clips. Refreshed hourly{lastFetch ? `, last ${ago(lastFetch)}` : ""}.
          </p>
        </div>
        <form method="post" action="/metrics/refresh"><button class="sm">Refresh now</button></form>
      </div>
      <Flash msg={props.flash} />

      {rows.length === 0 ? (
        <div class="empty">No published clips yet. Stats appear here once a clip is live on YouTube, TikTok or Instagram.</div>
      ) : (
        <>
          <section class="panel">
            <div class="kpis">
              <div><small>Views</small><strong>{compact(sum("views"))}</strong></div>
              <div><small>Likes</small><strong>{compact(sum("likes"))}</strong></div>
              <div><small>Comments</small><strong>{compact(sum("comments"))}</strong></div>
              <div><small>Shares</small><strong>{compact(sum("shares"))}</strong></div>
              <div><small>Live posts</small><strong>{live()}</strong></div>
            </div>
          </section>

          <div class="status" style="margin-top:12px">
            {PLATFORMS.map((pf) => (
              <div class="tile">
                <b class="row" style="gap:6px"><span class={`pf ${PF[pf].cls} ${live(pf) ? "live" : "none"}`}>{PF[pf].short}</span>{PF[pf].name}</b>
                <span style="font-size:18px;font-weight:700;font-variant-numeric:tabular-nums">{compact(sum("views", pf))} <span class="muted small" style="font-weight:400">views</span></span>
                <span class="muted small">{compact(sum("likes", pf))} likes · {compact(sum("comments", pf))} comments · {live(pf)} live</span>
              </div>
            ))}
          </div>

          {notes.length ? (
            <div class="callout" style="margin:12px 0">
              {notes.map((n) => <div>{n}</div>)}
            </div>
          ) : null}

          <h2>Top clips</h2>
          <div class="table" style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Clip</th>
                  {PLATFORMS.map((pf) => <th style="text-align:right">{PF[pf].short} views</th>)}
                  <th style="min-width:160px">Total views</th>
                  <th style="text-align:right">Likes</th>
                  <th style="text-align:right">Comments</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ c, m, views }) => (
                  <tr>
                    <td>
                      <a href={`/clips/${c.id}`} class="row" style="gap:10px;flex-wrap:nowrap;text-decoration:none">
                        {c.thumb_key ? <img src={`/media/${c.thumb_key}`} alt="" loading="lazy" style="width:30px;height:53px;object-fit:cover;border-radius:5px;background:#000" /> : null}
                        <span style="font-weight:500">{c.title ?? c.id}</span>
                      </a>
                    </td>
                    {PLATFORMS.map((pf) => (
                      <td style="text-align:right;font-variant-numeric:tabular-nums" class={m[pf] ? undefined : "muted"}>
                        {m[pf] ? compact(m[pf]!.views) : "—"}
                      </td>
                    ))}
                    <td>
                      <div class="row" style="gap:10px;flex-wrap:nowrap">
                        <div class="bar grow"><i style={`width:${Math.round((views / maxViews) * 100)}%`} /></div>
                        <span style="font-variant-numeric:tabular-nums;font-weight:600;min-width:44px;text-align:right">{compact(views)}</span>
                      </div>
                    </td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">{compact(total(m, "likes"))}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">{compact(total(m, "comments"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
