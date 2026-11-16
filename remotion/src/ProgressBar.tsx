import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 10, width: `${(frame / durationInFrames) * 100}%`, background: "#FFE14D" }} />
    </AbsoluteFill>
  );
};
