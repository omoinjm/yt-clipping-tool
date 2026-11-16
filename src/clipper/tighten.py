"""auto-editor: remove silences / dead air inside a clip."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def tighten(src: Path, dst: Path, margin: float = 0.15, threshold: str = "4%") -> None:
    exe = shutil.which("auto-editor") or str(Path(sys.executable).parent / "auto-editor")
    args = [
        exe, str(src),
        "--edit", f"audio:threshold={threshold}",
        "--margin", f"{margin}s",
        "--video-codec", "libx264",
        "--audio-codec", "aac",
        "--no-open",
        "-o", str(dst),
    ]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0 or not dst.exists():
        raise RuntimeError(f"auto-editor failed:\n{proc.stderr[-2000:]}")
