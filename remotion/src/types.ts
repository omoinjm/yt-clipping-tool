import type { Caption } from "@remotion/captions";

export type ShortClipProps = {
  /** Path relative to remotion/public, e.g. "clips/ep01-01.mp4" */
  src: string;
  durationSec: number;
  hook: string;
  captions: Caption[];
};
