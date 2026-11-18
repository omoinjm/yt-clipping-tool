import "./font";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { headerCss, splitHighlight, type HeaderStyle } from "./header";

/** The clip's header ("hook card"), styled by a HeaderStyle (see header.ts / the dashboard's editor). */
export const HookCard: React.FC<{ text: string; style: HeaderStyle }> = ({ text, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const end = style.duration > 0 ? Math.min(durationInFrames, Math.round(style.duration * fps)) : durationInFrames;
  if (frame > end) return null;

  const css = headerCss(style);
  const enter = spring({ frame, fps, config: { damping: 14 } });
  // Timed headers fade out over their last 8 frames; whole-clip headers stay put.
  const exit = style.duration > 0 ? interpolate(frame, [end - 8, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const motion =
    style.animation === "pop" ? { opacity: exit, transform: `scale(${enter}) rotate(${style.rotate}deg)` }
    : style.animation === "slide" ? { opacity: exit * fadeIn, transform: `translateY(${(1 - enter) * -80}px) rotate(${style.rotate}deg)` }
    : style.animation === "fade" ? { opacity: exit * fadeIn, transform: `rotate(${style.rotate}deg)` }
    : { opacity: exit, transform: `rotate(${style.rotate}deg)` };

  return (
    <AbsoluteFill style={css.layer as React.CSSProperties}>
      <div style={{ ...(css.box as React.CSSProperties), ...motion }}>
        {splitHighlight(text).map((part) => (part.hl ? <span style={css.highlight as React.CSSProperties}>{part.t}</span> : part.t))}
      </div>
    </AbsoluteFill>
  );
};
