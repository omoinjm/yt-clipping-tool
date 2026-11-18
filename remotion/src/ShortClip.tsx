import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Captions } from "./Captions";
import { HookCard } from "./HookCard";
import { ProgressBar } from "./ProgressBar";
import type { ShortClipProps } from "./types";
import { normalizeHeader } from "./header";
import { DEFAULT_PRESET_ID, HEADER_PRESETS } from "./header-presets";

const DEFAULT_STYLE = HEADER_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.style;

export const ShortClip: React.FC<ShortClipProps> = ({ src, hook, captions, header }) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <OffthreadVideo src={staticFile(src)} />
    <Captions captions={captions} />
    {hook ? <HookCard text={hook} style={header ? normalizeHeader(header) : DEFAULT_STYLE} /> : null}
    <ProgressBar />
  </AbsoluteFill>
);
