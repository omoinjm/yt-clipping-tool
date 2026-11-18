/**
 * Clip header ("hook card") style: shared by the Remotion render and the dashboard's live preview,
 * so what you preview is what renders. Pure TypeScript: no Remotion/React imports.
 * Coordinates are in the 1080×1920 render space.
 */

export const FONTS = {
  Montserrat: [600, 700, 800, 900],
  Anton: [400],
  "Bebas Neue": [400],
  "Archivo Black": [400],
  Bangers: [400],
  Oswald: [500, 600, 700],
  Poppins: [600, 700, 800, 900],
  Inter: [600, 700, 800, 900],
} as const;
export type FontName = keyof typeof FONTS;

export type HeaderStyle = {
  // text
  font: FontName;
  weight: number;
  size: number; // px at 1080 wide
  color: string;
  uppercase: boolean;
  letterSpacing: number; // px
  lineHeight: number;
  strokeColor: string;
  strokeWidth: number; // px, 0 = none
  shadow: boolean;
  // words wrapped in *asterisks*
  highlightColor: string;
  highlightBg: string; // "" = none
  // box
  box: "none" | "rect" | "pill" | "banner";
  bg: string;
  bgOpacity: number; // 0..1
  radius: number;
  paddingX: number;
  paddingY: number;
  borderColor: string;
  borderWidth: number;
  rotate: number; // degrees
  maxWidth: number; // px
  // placement
  position: "top" | "center" | "bottom";
  offsetY: number; // px from that edge
  // motion
  animation: "pop" | "slide" | "fade" | "none";
  duration: number; // seconds on screen; 0 = the whole clip
};

export const DEFAULT_HEADER: HeaderStyle = {
  font: "Montserrat", weight: 900, size: 64, color: "#111111", uppercase: false, letterSpacing: 0, lineHeight: 1.15,
  strokeColor: "#000000", strokeWidth: 0, shadow: true, highlightColor: "#E11D48", highlightBg: "",
  box: "rect", bg: "#FFFFFF", bgOpacity: 1, radius: 22, paddingX: 40, paddingY: 24, borderColor: "#000000", borderWidth: 0,
  rotate: -2, maxWidth: 900, position: "top", offsetY: 250, animation: "pop", duration: 2.5,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Clamp/validate anything (user input, stored JSON) into a safe HeaderStyle. */
export function normalizeHeader(input: unknown): HeaderStyle {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_HEADER;
  const font = pick(s.font, Object.keys(FONTS) as FontName[], d.font);
  const weights: readonly number[] = FONTS[font];
  const w = num(s.weight, 100, 900, d.weight);
  return {
    font,
    weight: weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), weights[0]),
    size: num(s.size, 24, 160, d.size),
    color: color(s.color, d.color),
    uppercase: s.uppercase === true || s.uppercase === "true" || s.uppercase === "on",
    letterSpacing: num(s.letterSpacing, -4, 20, d.letterSpacing),
    lineHeight: num(s.lineHeight, 0.8, 1.8, d.lineHeight),
    strokeColor: color(s.strokeColor, d.strokeColor),
    strokeWidth: num(s.strokeWidth, 0, 30, d.strokeWidth),
    shadow: s.shadow === true || s.shadow === "true" || s.shadow === "on",
    highlightColor: color(s.highlightColor, d.highlightColor),
    highlightBg: s.highlightBg === "" ? "" : color(s.highlightBg, ""),
    box: pick(s.box, ["none", "rect", "pill", "banner"] as const, d.box),
    bg: color(s.bg, d.bg),
    bgOpacity: num(s.bgOpacity, 0, 1, d.bgOpacity),
    radius: num(s.radius, 0, 200, d.radius),
    paddingX: num(s.paddingX, 0, 120, d.paddingX),
    paddingY: num(s.paddingY, 0, 120, d.paddingY),
    borderColor: color(s.borderColor, d.borderColor),
    borderWidth: num(s.borderWidth, 0, 20, d.borderWidth),
    rotate: num(s.rotate, -15, 15, d.rotate),
    maxWidth: num(s.maxWidth, 300, 1080, d.maxWidth),
    position: pick(s.position, ["top", "center", "bottom"] as const, d.position),
    offsetY: num(s.offsetY, 0, 900, d.offsetY),
    animation: pick(s.animation, ["pop", "slide", "fade", "none"] as const, d.animation),
    duration: num(s.duration, 0, 60, d.duration),
  };
}

/** Stable short hash of a style + text, to know whether a clip's video matches its current header. */
export function headerHash(style: HeaderStyle, text: string): string {
  const str = JSON.stringify([normalizeHeader(style), text]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** "Why *nobody* talks about it" → [{t:"Why "},{t:"nobody",hl:true},{t:" talks about it"}] */
export function splitHighlight(text: string): { t: string; hl: boolean }[] {
  return text.split(/(\*[^*]+\*)/g).filter(Boolean).map((t) => (t.startsWith("*") && t.endsWith("*") && t.length > 2 ? { t: t.slice(1, -1), hl: true } : { t, hl: false }));
}

export const plainHook = (text: string) => text.replace(/\*([^*]+)\*/g, "$1");

type Css = Record<string, string | number>;

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** CSS (React-style camelCase) for the positioning layer, the box, the text and highlighted words. */
export function headerCss(s: HeaderStyle): { layer: Css; box: Css; highlight: Css } {
  const banner = s.box === "banner";
  const hasBox = s.box !== "none";
  const layer: Css = {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: s.position === "top" ? "flex-start" : s.position === "bottom" ? "flex-end" : "center",
    ...(s.position === "top" ? { paddingTop: s.offsetY } : s.position === "bottom" ? { paddingBottom: s.offsetY } : { paddingTop: s.offsetY }),
    boxSizing: "border-box",
  };
  const box: Css = {
    fontFamily: `"${s.font}", sans-serif`,
    fontWeight: s.weight,
    fontSize: s.size,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    color: s.color,
    textTransform: s.uppercase ? "uppercase" : "none",
    textAlign: "center",
    overflowWrap: "break-word",
    boxSizing: "border-box",
    maxWidth: banner ? 1080 : s.maxWidth,
    width: banner ? 1080 : "auto",
    padding: hasBox ? `${s.paddingY}px ${s.paddingX}px` : 0,
    background: hasBox ? rgba(s.bg, s.bgOpacity) : "transparent",
    borderRadius: banner ? 0 : s.box === "pill" ? 999 : s.radius,
    border: hasBox && s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor}` : "none",
    boxShadow: hasBox && s.shadow ? "0 14px 44px rgba(0,0,0,0.45)" : "none",
    textShadow: !hasBox && s.shadow ? "0 6px 22px rgba(0,0,0,0.65)" : "none",
    WebkitTextStroke: s.strokeWidth ? `${s.strokeWidth}px ${s.strokeColor}` : "0",
    paintOrder: "stroke fill",
  };
  const highlight: Css = {
    color: s.highlightColor,
    ...(s.highlightBg ? { background: s.highlightBg, borderRadius: 10, padding: "0 0.18em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" } : {}),
  };
  return { layer, box, highlight };
}

/** camelCase CSS object → inline style text (dashboard SSR preview). */
export function cssText(css: Css): string {
  return Object.entries(css)
    // WebkitTextStroke → -webkit-text-stroke (the leading capital becomes the vendor dash)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${typeof v === "number" && !["fontWeight", "lineHeight", "opacity"].includes(k) ? `${v}px` : v}`)
    .join(";");
}
