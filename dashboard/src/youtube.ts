import type { ClipRow } from "./db";

export function buildDescription(description: string, credit: string | null, tags: string[]): string {
  const parts = [description.trim()];
  if (credit) parts.push(`Original: ${credit}`);
  const hashtags = tags.slice(0, 3).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  parts.push(`#Shorts ${hashtags}`.trim());
  return parts.filter(Boolean).join("\n\n");
}

async function accessToken(env: Env): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YT_CLIENT_ID,
      client_secret: env.YT_CLIENT_SECRET,
      refresh_token: env.YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

/** Stream a clip from R2 into a YouTube resumable upload. Returns the YouTube video id. */
export async function uploadToYouTube(
  env: Env,
  clip: ClipRow,
  credit: string | null,
  privacy: "private" | "unlisted" | "public",
): Promise<string> {
  if (!env.YT_REFRESH_TOKEN) throw new Error("YouTube not connected: set YT_* secrets (run `clipper youtube-auth`)");
  if (!clip.video_key) throw new Error("clip has no video in R2 yet");
  const head = await env.CLIPS.head(clip.video_key);
  if (!head) throw new Error(`missing R2 object ${clip.video_key}`);

  const token = await accessToken(env);
  const tags: string[] = JSON.parse(clip.tags || "[]");
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(head.size),
      },
      body: JSON.stringify({
        snippet: {
          title: (clip.title ?? clip.id).slice(0, 100),
          description: buildDescription(clip.description ?? "", credit, tags).slice(0, 5000),
          tags: tags.slice(0, 15),
          categoryId: env.YT_CATEGORY_ID || "22",
        },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    },
  );
  const uploadUrl = init.headers.get("Location");
  if (!init.ok || !uploadUrl) throw new Error(`YouTube upload init failed: ${init.status} ${await init.text()}`);

  const obj = await env.CLIPS.get(clip.video_key);
  if (!obj) throw new Error(`missing R2 object ${clip.video_key}`);
  // FixedLengthStream lets fetch send a streamed body with a known Content-Length (no buffering).
  const { readable, writable } = new FixedLengthStream(obj.size);
  const pump = obj.body.pipeTo(writable);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(obj.size) },
    body: readable,
  });
  await pump;
  if (!put.ok) throw new Error(`YouTube upload failed: ${put.status} ${await put.text()}`);
  const video = await put.json<{ id: string }>();
  return video.id;
}
