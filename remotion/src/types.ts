import type { Caption } from "@remotion/captions";
import type { HeaderStyle } from "./header";

export type ShortClipProps = {
  /** Path relative to remotion/public, e.g. "clips/ep01-01.mp4" */
  src: string;
  durationSec: number;
  hook: string;
  /** Header style (validated with normalizeHeader); omitted = the default preset. */
  header?: HeaderStyle;
  captions: Caption[];
};
