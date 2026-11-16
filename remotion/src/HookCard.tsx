import { fontFamily } from "./font";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const SHOW_SEC = 2.5;

export const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const end = SHOW_SEC * fps;
  if (frame > end) return null;

  const enter = spring({ frame, fps, config: { damping: 14 } });
  const exit = interpolate(frame, [end - 8, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 260 }}>
      <div
        style={{
          background: "white",
          color: "black",
          fontFamily,
          fontWeight: 900,
          fontSize: 64,
          lineHeight: 1.15,
          padding: "22px 36px",
          borderRadius: 18,
          maxWidth: 900,
          textAlign: "center",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          opacity: exit,
          transform: `scale(${enter}) rotate(-2deg)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
