"""Pick the best Shorts candidates from a transcript using Claude, then snap edges cleanly."""

from __future__ import annotations

import json
from typing import Any

from .config import settings

SYSTEM_PROMPT = """\
You are a short-form video editor who picks moments from long-form videos that will perform as \
YouTube Shorts. A great Short:
- Hooks in the first 2 seconds: a bold claim, a surprising fact, a question, conflict, or a punchline setup.
- Is self-contained: makes sense with no context from the rest of the video.
- Has a payoff: an answer, a twist, a laugh, or a strong takeaway before it ends.
- Starts at the beginning of a sentence and ends at the end of one.

You will get a timestamped transcript ([start-end] speaker: text). Return the strongest \
non-overlapping segments. Use only timestamps that appear in the transcript. Write the title, \
hook text and description in the transcript's language. Hook text is a short on-screen caption \
shown over the first seconds (max 8 words, no emojis). Titles max 70 characters, no clickbait \
the clip cannot deliver. Score honestly: 90+ only for genuinely viral-grade moments."""

CANDIDATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number", "description": "seconds"},
                    "end": {"type": "number", "description": "seconds"},
                    "score": {"type": "integer", "description": "0-100 predicted Shorts performance"},
                    "hook": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "reason": {"type": "string", "description": "one sentence: why this works"},
                },
                "required": ["start", "end", "score", "hook", "title", "description", "tags", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["candidates"],
    "additionalProperties": False,
}


def format_transcript(transcript: dict[str, Any]) -> str:
    lines = []
    for s in transcript["segments"]:
        who = f"{s['speaker']}: " if s.get("speaker") else ""
        lines.append(f"[{s['start']:.1f}-{s['end']:.1f}] {who}{s['text']}")
    return "\n".join(lines)


def ask_claude(transcript: dict[str, Any], n: int) -> list[dict[str, Any]]:
    import anthropic

    client = anthropic.Anthropic()
    user = (
        f"Find up to {n * 2} candidate Shorts, each {settings.min_clip_s:.0f}-{settings.max_clip_s:.0f} "
        f"seconds long, best first.\n\n<transcript>\n{format_transcript(transcript)}\n</transcript>"
    )
    response = client.beta.messages.create(
        model=settings.anthropic_model,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": CANDIDATE_SCHEMA}},
        messages=[{"role": "user", "content": user}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude declined clip selection: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("Claude response truncated (max_tokens); reduce candidate count")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)["candidates"]


# ---------- pure post-processing (unit tested) ----------

def _sentence_bounds(transcript: dict[str, Any]) -> tuple[list[float], list[float]]:
    """Candidate start/end points: segment boundaries plus words that end a sentence."""
    starts, ends = [], []
    for seg in transcript["segments"]:
        starts.append(seg["start"])
        ends.append(seg["end"])
        words = seg.get("words", [])
        for i, w in enumerate(words):
            if w["word"].rstrip().endswith((".", "?", "!")):
                ends.append(w["end"])
                if i + 1 < len(words):
                    starts.append(words[i + 1]["start"])
    return sorted(set(starts)), sorted(set(ends))


def _nearest(points: list[float], t: float, window: float) -> float | None:
    best = min(points, key=lambda p: abs(p - t), default=None)
    return best if best is not None and abs(best - t) <= window else None


def snap(
    cand: dict[str, Any],
    transcript: dict[str, Any],
    cuts: list[float],
    min_s: float,
    max_s: float,
    window: float = 3.0,
) -> dict[str, Any] | None:
    """Snap start/end to sentence boundaries (preferring scene cuts nearby). None if unusable."""
    starts, ends = _sentence_bounds(transcript)
    start = _nearest(starts, cand["start"], window)
    end = _nearest(ends, cand["end"], window)
    start = cand["start"] if start is None else start
    end = cand["end"] if end is None else end

    # A scene cut within 0.4s of a speech boundary makes a cleaner visual edit.
    cut_s = _nearest(cuts, start, 0.4)
    if cut_s is not None and cut_s <= start:
        start = cut_s
    cut_e = _nearest(cuts, end, 0.4)
    if cut_e is not None and cut_e >= end:
        end = cut_e

    if end - start > max_s:
        # Trim to the last sentence end that fits.
        fitting = [e for e in ends if start + min_s <= e <= start + max_s]
        if not fitting:
            return None
        end = fitting[-1]
    if end - start < min_s:
        return None
    return {**cand, "start": round(start, 3), "end": round(end, 3)}


def overlap(a: dict[str, Any], b: dict[str, Any]) -> float:
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    shorter = min(a["end"] - a["start"], b["end"] - b["start"])
    return inter / shorter if shorter > 0 else 0.0


def postprocess(
    candidates: list[dict[str, Any]],
    transcript: dict[str, Any],
    cuts: list[float],
    duration: float,
    n: int,
    min_s: float,
    max_s: float,
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for cand in sorted(candidates, key=lambda c: c.get("score", 0), reverse=True):
        if not (0 <= cand["start"] < cand["end"] <= duration + 1):
            continue
        snapped = snap(cand, transcript, cuts, min_s, max_s)
        if snapped is None or any(overlap(snapped, k) > 0.3 for k in kept):
            continue
        kept.append(snapped)
        if len(kept) >= n:
            break
    return kept
