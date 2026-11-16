"""PySceneDetect shot-boundary detection."""

from __future__ import annotations

import json
from pathlib import Path


def detect(video: Path, out_path: Path, threshold: float = 27.0, min_scene_len_s: float = 0.6) -> list[list[float]]:
    from scenedetect import ContentDetector, detect as sd_detect

    # min_scene_len is in frames; assume 30fps normalized input.
    scene_list = sd_detect(
        str(video),
        ContentDetector(threshold=threshold, min_scene_len=int(min_scene_len_s * 30)),
        show_progress=False,
    )
    scenes = [[start.get_seconds(), end.get_seconds()] for start, end in scene_list]
    out_path.write_text(json.dumps(scenes))
    return scenes


def cuts(scenes: list[list[float]]) -> list[float]:
    """Boundary timestamps between shots (excludes 0 and the end)."""
    return [s[0] for s in scenes[1:]]


def scenes_within(scenes: list[list[float]], start: float, end: float) -> list[tuple[float, float]]:
    """Scenes clipped to [start, end], re-based to start at 0. Whole range if no scenes."""
    out = []
    for s, e in scenes:
        s2, e2 = max(s, start), min(e, end)
        if e2 - s2 > 0.05:
            out.append((s2 - start, e2 - start))
    return out or [(0.0, end - start)]
