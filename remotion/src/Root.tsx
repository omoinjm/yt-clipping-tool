import { Composition } from "remotion";
import { ShortClip } from "./ShortClip";
import type { ShortClipProps } from "./types";

const FPS = 30;

const defaultProps: ShortClipProps = {
  src: "clips/sample.mp4",
  durationSec: 10,
  hook: "This changes everything",
  captions: [
    { text: " This", startMs: 0, endMs: 400, timestampMs: 0, confidence: 1 },
    { text: " is", startMs: 400, endMs: 600, timestampMs: 400, confidence: 1 },
    { text: " a", startMs: 600, endMs: 700, timestampMs: 600, confidence: 1 },
    { text: " sample", startMs: 700, endMs: 1200, timestampMs: 700, confidence: 1 },
    { text: " caption.", startMs: 1200, endMs: 1800, timestampMs: 1200, confidence: 1 },
  ],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ShortClip"
    component={ShortClip}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={defaultProps.durationSec * FPS}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.floor(props.durationSec * FPS)),
    })}
  />
);
