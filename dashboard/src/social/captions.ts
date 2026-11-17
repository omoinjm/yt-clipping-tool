import type { ClipRow } from "../db";
import type { Platform } from "./tokens";

export const CAPTION_MAX = 2200; // both TikTok (UTF-16 units) and Instagram

const hashtag = (t: string) => "#" + t.normalize("NFKD").replace(/[^\p{L}\p{N}_]/gu, "");

export function hashtags(tags: string[], n: number): string {
  const out = new Map<string, string>(); // lowercase → as written
  for (const t of tags) {
    if (out.size >= n) break;
    const h = hashtag(t);
    if (h.length > 1 && !out.has(h.toLowerCase())) out.set(h.toLowerCase(), h);
  }
  return [...out.values()].join(" ");
}

export function creditLine(credit: string | null): string | null {
  return credit ? `Credit: ${credit}` : null;
}

/** Caption built from the clip's (Claude-written, user-editable) title, description and tags. */
export function autoCaption(platform: Platform, clip: ClipRow, credit: string | null): string {
  const tags: string[] = JSON.parse(clip.tags || "[]");
  const parts =
    platform === "tiktok"
      ? // TikTok: short; the hook line does the work, hashtags help discovery.
        [clip.title, creditLine(credit), hashtags(tags, 5)]
      : // Instagram Reels: room for the description; keep hashtags few (3–5 perform best, 30 max).
        [clip.title, clip.description, creditLine(credit), hashtags(tags, 5)];
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n\n").slice(0, CAPTION_MAX);
}

export function savedCaptions(clip: ClipRow): Partial<Record<Platform, string>> {
  try {
    return JSON.parse(clip.captions || "{}");
  } catch {
    return {};
  }
}

/** The caption to show / post: the user's own if they saved one, else the auto caption. */
export function captionFor(platform: Platform, clip: ClipRow, credit: string | null): { text: string; custom: boolean } {
  const own = savedCaptions(clip)[platform];
  return own ? { text: own, custom: true } : { text: autoCaption(platform, clip, credit), custom: false };
}

/** Credited sources (CC BY, permission granted) must name the creator; add the line back if it was edited out. */
export function withCredit(caption: string, credit: string | null): string {
  if (!credit || caption.toLowerCase().includes(credit.toLowerCase())) return caption.slice(0, CAPTION_MAX);
  const line = creditLine(credit)!;
  return `${caption.slice(0, CAPTION_MAX - line.length - 2).trimEnd()}\n\n${line}`;
}
