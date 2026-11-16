"""sources.yaml registry with a hard permission gate."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

# own: you made it · granted: written permission (proof + credit)
# cc_by: published under Creative Commons Attribution; credit required, license verified before download
ALLOWED_PERMISSIONS = {"own", "granted", "cc_by"}
CC_BY_MARKERS = ("creative commons attribution", "cc by", "cc-by")


class PermissionError_(RuntimeError):
    pass


@dataclass
class Source:
    id: str
    owner: str
    permission: str
    path: str | None = None
    url: str | None = None
    proof: str | None = None
    credit: str | None = None

    @property
    def origin(self) -> str:
        return self.url or self.path or ""


def load(path: Path) -> dict[str, Source]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; copy sources.example.yaml to sources.yaml")
    raw = yaml.safe_load(path.read_text()) or {}
    out: dict[str, Source] = {}
    for item in raw.get("sources", []):
        src = Source(**item)
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", src.id):
            raise ValueError(f"source id {src.id!r} must be alphanumeric/dash/underscore")
        out[src.id] = src
    return out


def check_permission(src: Source) -> None:
    if src.permission not in ALLOWED_PERMISSIONS:
        raise PermissionError_(
            f"source {src.id!r} has permission={src.permission!r}; must be one of {sorted(ALLOWED_PERMISSIONS)}"
        )
    if src.permission == "granted" and not (src.proof and src.credit):
        raise PermissionError_(f"source {src.id!r} is 'granted' but is missing `proof` and/or `credit`")
    if src.permission == "cc_by" and not (src.url and src.credit):
        raise PermissionError_(f"source {src.id!r} is 'cc_by' but needs a `url` (to verify the license) and `credit`")
    if not (src.path or src.url):
        raise ValueError(f"source {src.id!r} needs `path` or `url`")


def is_cc_by(license_text: str | None) -> bool:
    text = (license_text or "").lower()
    # Reject NonCommercial / NoDerivatives variants: monetized, edited clips need neither restriction.
    if any(x in text for x in ("noncommercial", "non-commercial", "-nc", "noderiv", "-nd")):
        return False
    return any(m in text for m in CC_BY_MARKERS)


def fetch(src: Source, dest_dir: Path) -> Path:
    """Return a local file for the source (downloads URLs with yt-dlp)."""
    if src.path:
        p = Path(src.path).expanduser()
        if not p.exists():
            raise FileNotFoundError(p)
        return p
    import yt_dlp

    opts = {
        "outtmpl": str(dest_dir / "download.%(ext)s"),
        "format": "bv*[height<=1080]+ba/b[height<=1080]",
        "merge_output_format": "mp4",
        "quiet": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        if src.permission == "cc_by":
            meta = ydl.extract_info(src.url, download=False)
            if not is_cc_by(meta.get("license")):
                raise PermissionError_(
                    f"source {src.id!r} was marked CC BY, but the video's license is "
                    f"{meta.get('license') or 'Standard YouTube License'!r}; get permission or pick another video"
                )
        info = ydl.extract_info(src.url, download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp4")
