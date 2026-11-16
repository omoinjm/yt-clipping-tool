"""Thin subprocess wrappers around ffmpeg / ffprobe."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


def _run(args: list[str]) -> str:
    if shutil.which(args[0]) is None:
        raise FFmpegError(f"{args[0]} not found on PATH")
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise FFmpegError(f"{' '.join(args[:6])}... failed:\n{proc.stderr[-2000:]}")
    return proc.stdout


@lru_cache(maxsize=1)
def video_encoder_args() -> tuple[str, ...]:
    """h264_nvenc when an NVIDIA GPU actually works (probe encode), else libx264.

    Override with CLIPPER_ENCODER=libx264|h264_nvenc.
    """
    choice = os.environ.get("CLIPPER_ENCODER")
    if choice is None:
        probe_cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                     "color=black:s=256x256:d=0.1", "-c:v", "h264_nvenc", "-f", "null", "-"]
        ok = shutil.which("ffmpeg") and subprocess.run(probe_cmd, capture_output=True).returncode == 0
        choice = "h264_nvenc" if ok else "libx264"
    if choice == "h264_nvenc":
        return ("-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-pix_fmt", "yuv420p")
    return ("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p")


def ffmpeg(*args: str) -> None:
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args])


def probe(path: Path) -> dict:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    return json.loads(out)


def duration(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


def video_size(path: Path) -> tuple[int, int]:
    for s in probe(path)["streams"]:
        if s["codec_type"] == "video":
            return int(s["width"]), int(s["height"])
    raise FFmpegError(f"no video stream in {path}")


def normalize(src: Path, dst: Path, fps: int = 30) -> None:
    """Constant frame rate h264/aac, so frame-accurate cuts and Remotion are happy."""
    ffmpeg(
        "-i", str(src),
        "-vf", f"fps={fps}",
        *video_encoder_args(),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        str(dst),
    )


def extract_audio(src: Path, dst: Path) -> None:
    """16 kHz mono WAV, the format Whisper expects."""
    ffmpeg("-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst))


def trim(src: Path, dst: Path, start: float, end: float) -> None:
    """Frame-accurate re-encoded trim (input-seek + re-encode is accurate in modern ffmpeg)."""
    ffmpeg(
        "-ss", f"{max(0.0, start):.3f}", "-i", str(src), "-t", f"{end - start:.3f}",
        *video_encoder_args(),
        "-c:a", "aac", "-b:a", "192k",
        str(dst),
    )


def crop_vertical(src: Path, dst: Path, filtergraph: str, fps: int = 30) -> None:
    ffmpeg(
        "-i", str(src), "-filter_complex", filtergraph, "-map", "[out]", "-map", "0:a?",
        "-r", str(fps),
        *video_encoder_args(),
        "-c:a", "aac", "-b:a", "192k",
        str(dst),
    )


def thumbnail(src: Path, dst: Path, at: float = 1.0, width: int = 540) -> None:
    ffmpeg("-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", str(dst))
