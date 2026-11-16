"""Runtime settings, loaded from environment / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _env(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name)
    return val if val not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    root: Path = ROOT
    work_dir: Path = field(default_factory=lambda: Path(_env("CLIPPER_WORK_DIR", str(ROOT / "work"))))
    db_path: Path = field(default_factory=lambda: Path(_env("CLIPPER_DB", str(ROOT / "clipper.db"))))
    sources_file: Path = field(default_factory=lambda: Path(_env("CLIPPER_SOURCES", str(ROOT / "sources.yaml"))))
    models_dir: Path = ROOT / "models"
    remotion_dir: Path = ROOT / "remotion"

    # Transcription
    whisper_model: str = field(default_factory=lambda: _env("WHISPER_MODEL", "small"))
    whisper_device: str = field(default_factory=lambda: _env("WHISPER_DEVICE", "auto"))  # auto|cpu|cuda
    whisper_compute_type: str | None = field(default_factory=lambda: _env("WHISPER_COMPUTE_TYPE"))
    whisper_batch_size: int = field(default_factory=lambda: int(_env("WHISPER_BATCH_SIZE", "4")))
    language: str | None = field(default_factory=lambda: _env("WHISPER_LANGUAGE"))
    hf_token: str | None = field(default_factory=lambda: _env("HF_TOKEN"))

    # Selection
    # bedrock (default; billed through AWS, IAM auth) or anthropic (needs ANTHROPIC_API_KEY)
    claude_provider: str = field(default_factory=lambda: _env("CLAUDE_PROVIDER", "bedrock"))
    aws_region: str = field(default_factory=lambda: _env("AWS_REGION", _env("AWS_DEFAULT_REGION", "eu-west-1")))
    anthropic_model: str = field(
        default_factory=lambda: _env(
            "ANTHROPIC_MODEL",
            # Bedrock serves Opus 5.5 through the EU cross-region inference profile.
            "eu.anthropic.claude-opus-5-5" if _env("CLAUDE_PROVIDER", "bedrock") == "bedrock" else "claude-opus-5-5",
        )
    )
    min_clip_s: float = 20.0
    max_clip_s: float = 60.0
    clips_per_source: int = field(default_factory=lambda: int(_env("CLIPS_PER_SOURCE", "5")))

    # Output
    width: int = 1080
    height: int = 1920
    fps: int = 30

    # YouTube
    yt_client_secrets: Path = field(
        default_factory=lambda: Path(_env("YT_CLIENT_SECRETS", str(ROOT / "client_secret.json")))
    )
    yt_token_file: Path = field(default_factory=lambda: Path(_env("YT_TOKEN_FILE", str(ROOT / ".yt_token.json"))))
    yt_category_id: str = field(default_factory=lambda: _env("YT_CATEGORY_ID", "22"))  # People & Blogs


settings = Settings()
