/**
 * Built-in header presets, modelled on common clip-channel formats. Seeded into the dashboard as
 * read-only styles (copy one to customise it). Wrap a key word in *asterisks* to use the highlight.
 */
import { DEFAULT_HEADER, normalizeHeader, type HeaderStyle } from "./header";

const p = (s: Partial<HeaderStyle>): HeaderStyle => normalizeHeader({ ...DEFAULT_HEADER, ...s });

export const HEADER_PRESETS: { id: string; name: string; note: string; style: HeaderStyle }[] = [
  {
    id: "pop-card",
    name: "Pop card",
    note: "White card that pops in for the first seconds (the original look, cleaned up).",
    style: p({ font: "Montserrat", weight: 900, size: 66, color: "#111111", box: "rect", bg: "#FFFFFF", radius: 24, rotate: -2, highlightColor: "#E11D48", duration: 3 }),
  },
  {
    id: "podcast-bar",
    name: "Podcast title bar",
    note: "Full-width bar that stays for the whole clip, like podcast clip channels.",
    style: p({
      font: "Montserrat", weight: 900, size: 58, color: "#FFFFFF", uppercase: true, box: "banner", bg: "#000000", bgOpacity: 0.92,
      paddingX: 48, paddingY: 30, rotate: 0, shadow: false, highlightColor: "#FFD84D", offsetY: 200, animation: "fade", duration: 0,
    }),
  },
  {
    id: "bold-outline",
    name: "Bold outline",
    note: "No box: big white letters with a thick black outline.",
    style: p({
      font: "Anton", size: 92, color: "#FFFFFF", uppercase: true, letterSpacing: 1, lineHeight: 1.05, strokeColor: "#000000", strokeWidth: 16,
      box: "none", rotate: 0, shadow: true, highlightColor: "#FFD84D", maxWidth: 980, offsetY: 230, duration: 3.5,
    }),
  },
  {
    id: "keyword-highlight",
    name: "Black box + keyword",
    note: "Black box, white text, key words in yellow (wrap them in *asterisks*).",
    style: p({
      font: "Montserrat", weight: 900, size: 62, color: "#FFFFFF", box: "rect", bg: "#0B0B0B", radius: 14, rotate: 0,
      highlightColor: "#111111", highlightBg: "#FFD84D", paddingX: 36, paddingY: 22, animation: "slide", duration: 3.5,
    }),
  },
  {
    id: "sticker",
    name: "Tilted sticker",
    note: "Bright sticker with a dark border, tilted for energy.",
    style: p({
      font: "Bangers", size: 84, color: "#111111", letterSpacing: 2, box: "rect", bg: "#FFD84D", radius: 18, borderColor: "#111111",
      borderWidth: 7, rotate: -4, highlightColor: "#E11D48", paddingX: 38, paddingY: 18, duration: 3,
    }),
  },
  {
    id: "minimal-pill",
    name: "Minimal pill",
    note: "Small, semi-transparent pill. Quiet, stays the whole clip.",
    style: p({
      font: "Inter", weight: 800, size: 44, color: "#FFFFFF", box: "pill", bg: "#000000", bgOpacity: 0.55, paddingX: 34, paddingY: 16,
      rotate: 0, shadow: false, highlightColor: "#7DD3FC", maxWidth: 820, offsetY: 210, animation: "fade", duration: 0,
    }),
  },
];

export const DEFAULT_PRESET_ID = "pop-card";
