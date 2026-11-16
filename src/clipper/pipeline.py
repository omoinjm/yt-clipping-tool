"""Pipeline stages, shared by the local CLI (`run`) and the cloud worker (`cloud-run`)."""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import ffmpeg
from .config import settings
from .state import State


def log(msg: str) -> None:
    print(msg, flush=True)


@contextmanager
def timed(label: str):
    t0 = time.monotonic()
    yield
    log(f"⏱ {label}: {time.monotonic() - t0:.1f}s")


def workdir(source_id: str) -> Path:
    d = settings.work_dir / source_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def clipdir(source_id: str, clip_id: str) -> Path:
    d = workdir(source_id) / "clips" / clip_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def ingest(state: State, row: dict[str, Any], raw: Path, force: bool = False) -> None:
    """Normalize `raw` into work/<id>/source.mp4 + audio.wav and record the source."""
    wd = workdir(row["id"])
    out = wd / "source.mp4"
    if force or not out.exists():
        with timed("normalize"):
            ffmpeg.normalize(raw, out, settings.fps)
            ffmpeg.extract_audio(out, wd / "audio.wav")
    elif not (wd / "audio.wav").exists():
        ffmpeg.extract_audio(out, wd / "audio.wav")
    state.upsert_source(**{**row, "duration": ffmpeg.duration(out), "stage": "ingested"})
    log(f"✓ ingested {row['id']} ({ffmpeg.duration(out):.0f}s)")


def transcribe(state: State, source_id: str, diarize: bool = False, force: bool = False) -> None:
    from .transcribe import transcribe as run

    wd = workdir(source_id)
    out = wd / "transcript.json"
    if force or not out.exists():
        with timed("transcribe"):
            data = run(wd / "audio.wav", out, diarize=diarize)
        log(f"✓ {len(data['segments'])} segments, language={data['language']}")
    state.set_source_stage(source_id, "transcribed")


def scenes(state: State, source_id: str, force: bool = False) -> None:
    from .scenes import detect

    wd = workdir(source_id)
    out = wd / "scenes.json"
    if force or not out.exists():
        with timed("scenes"):
            found = detect(wd / "source.mp4", out)
        log(f"✓ {len(found)} scenes")
    state.set_source_stage(source_id, "scenes")


def select(state: State, source_id: str, n: int | None = None, force: bool = False) -> list[dict[str, Any]]:
    from . import select as sel
    from .scenes import cuts

    wd = workdir(source_id)
    existing = state.clips(source_id)
    if existing and not force:
        log(f"✓ {len(existing)} clips already selected")
        return existing

    row = state.source(source_id)
    transcript = json.loads((wd / "transcript.json").read_text())
    scene_list = json.loads((wd / "scenes.json").read_text()) if (wd / "scenes.json").exists() else []
    n = n or settings.clips_per_source

    with timed("select"):
        raw = sel.ask_claude(transcript, n)
    (wd / "candidates_raw.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False))
    kept = sel.postprocess(raw, transcript, cuts(scene_list), row["duration"], n,
                           settings.min_clip_s, settings.max_clip_s)
    for i, c in enumerate(kept, 1):
        c["id"] = f"{source_id}-{i:02d}"
    state.replace_clips(source_id, kept)
    state.set_source_stage(source_id, "selected")
    for c in kept:
        log(f"  {c['id']}  [{c['start']:7.1f}-{c['end']:7.1f}] {c['score']:3d}  {c['title']}")
    log(f"✓ {len(kept)} clips selected ({len(raw)} proposed)")
    return kept


def produce(
    state: State,
    source_id: str,
    clip: str | None = None,
    tighten: bool = True,
    force: bool = False,
    on_rendered: Callable[[dict[str, Any], Path], dict[str, Any]] | None = None,
) -> int:
    """Cut → auto-editor → re-align → reframe → render, per clip. Returns failure count.

    `on_rendered(row, final_path)` may publish the file and return extra fields for the clip record.
    """
    from .reframe import reframe
    from .render import render
    from .tighten import tighten as run_tighten
    from .transcribe import transcribe as run_transcribe, words

    wd = workdir(source_id)
    rows = [r for r in state.clips(source_id) if clip in (None, r["id"])]
    language = json.loads((wd / "transcript.json").read_text())["language"]
    failures = 0
    state.set_source_stage(source_id, "producing")
    for r in rows:
        cd = clipdir(source_id, r["id"])
        final = cd / "final.mp4"
        if r.get("stage") in ("rendered", "published", "uploaded") and final.exists() and not force:
            log(f"  skip {r['id']} ({r['stage']})")
            continue
        try:
            state.update_clip(r["id"], stage="rendering", error=None)
            with timed(f"{r['id']} total"):
                trimmed = cd / "trim.mp4"
                ffmpeg.trim(wd / "source.mp4", trimmed, max(0.0, r["start"] - 0.3), r["end"] + 0.5)
                body = trimmed
                if tighten:
                    body = cd / "tight.mp4"
                    run_tighten(trimmed, body)
                ffmpeg.extract_audio(body, cd / "audio.wav")
                # Reuse the source's language: detection on <30s audio is unreliable.
                t = run_transcribe(cd / "audio.wav", cd / "transcript.json", language=language)
                dur = ffmpeg.duration(body)
                if dur < settings.min_clip_s:
                    log(f"  ! {r['id']} is {dur:.1f}s after tightening (below min)")
                layout = reframe(body, cd / "vertical.mp4", cd)
                with timed(f"{r['id']} render ({layout})"):
                    render(r["id"], cd / "vertical.mp4", words(t), r.get("hook") or "", final)
            extra: dict[str, Any] = {"stage": "rendered", "output_path": str(final)}
            if on_rendered:
                extra = {**extra, **on_rendered(r, final)}
            state.update_clip(r["id"], duration=ffmpeg.duration(final), layout=layout, error=None, **extra)
            log(f"✓ {r['id']} → {extra.get('video_key', final)}")
        except Exception as e:  # keep going with the other clips
            failures += 1
            state.update_clip(r["id"], stage="failed", error=str(e)[:2000])
            print(f"✗ {r['id']}: {e}", file=sys.stderr, flush=True)
    state.set_source_stage(source_id, "done" if failures == 0 else "partial")
    return failures
