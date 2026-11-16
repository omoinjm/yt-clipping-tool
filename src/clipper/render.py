"""Hand a clip + word timings to the Remotion project and render the final Short."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import ffmpeg
from .config import settings


def to_captions(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """WhisperX words → @remotion/captions `Caption` objects (leading space = word boundary)."""
    out = []
    for w in words:
        text = w["word"].strip()
        if not text:
            continue
        start_ms = int(w["start"] * 1000)
        out.append({
            "text": " " + text,
            "startMs": start_ms,
            "endMs": max(start_ms + 1, int(w["end"] * 1000)),
            "timestampMs": start_ms,
            "confidence": w.get("score"),
        })
    return out


def render(clip_id: str, video: Path, words: list[dict[str, Any]], hook: str, out: Path) -> None:
    rdir = settings.remotion_dir
    if not (rdir / "node_modules").exists():
        raise RuntimeError(f"run `npm install` in {rdir} first")

    public_clip = rdir / "public" / "clips" / f"{clip_id}.mp4"
    public_clip.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(video, public_clip)

    props = {
        "src": f"clips/{clip_id}.mp4",
        "durationSec": ffmpeg.duration(video),
        "hook": hook,
        "captions": to_captions(words),
    }
    props_path = out.with_suffix(".props.json")
    props_path.write_text(json.dumps(props, ensure_ascii=False))

    try:
        proc = subprocess.run(
            [
                "npx", "remotion", "render", "src/index.ts", "ShortClip", str(out.resolve()),
                f"--props={props_path.resolve()}", "--codec=h264", "--crf=18",
                f"--concurrency={os.environ.get('REMOTION_CONCURRENCY') or max(2, (os.cpu_count() or 4) - 2)}",
            ],
            cwd=rdir, capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"remotion render failed:\n{(proc.stderr or proc.stdout)[-3000:]}")
    finally:
        public_clip.unlink(missing_ok=True)
