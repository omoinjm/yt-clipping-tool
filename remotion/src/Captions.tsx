import { fontFamily } from "./font";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { useMemo } from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

const HIGHLIGHT = "#FFE14D";
const COMBINE_MS = 900; // words shown together per "page"

const Page: React.FC<{ page: TikTokPage }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = page.startMs + (frame / fps) * 1000;
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 5 });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 520 }}>
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 92,
          lineHeight: 1.1,
          textAlign: "center",
          textTransform: "uppercase",
          color: "white",
          maxWidth: 940,
          WebkitTextStroke: "14px black",
          paintOrder: "stroke",
          textShadow: "0 8px 24px rgba(0,0,0,0.6)",
          transform: `scale(${0.85 + 0.15 * pop})`,
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((t) => {
          const active = t.fromMs <= nowMs && nowMs < t.toMs;
          return (
            <span key={t.fromMs} style={{ color: active ? HIGHLIGHT : "white" }}>
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: COMBINE_MS }),
    [captions],
  );

  return (
    <AbsoluteFill>
      {pages.map((page, i) => {
        const next = pages[i + 1];
        const from = Math.floor((page.startMs / 1000) * fps);
        const endMs = next ? Math.min(next.startMs, page.startMs + page.durationMs + 600) : page.startMs + page.durationMs;
        const duration = Math.max(1, Math.ceil(((endMs - page.startMs) / 1000) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            <Page page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
