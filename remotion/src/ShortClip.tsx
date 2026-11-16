import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Captions } from "./Captions";
import { HookCard } from "./HookCard";
import { ProgressBar } from "./ProgressBar";
import type { ShortClipProps } from "./types";

export const ShortClip: React.FC<ShortClipProps> = ({ src, hook, captions }) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <OffthreadVideo src={staticFile(src)} />
    <Captions captions={captions} />
    {hook ? <HookCard text={hook} /> : null}
    <ProgressBar />
  </AbsoluteFill>
);
