"""Object storage: S3 for sources + resumable work dirs, R2 for published clips."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

# Intermediates we don't bother persisting (cheap to regenerate).
SKIP_SYNC = {"trim.mp4", "tight.mp4", "vertical.mp4", "audio.wav"}


def _env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"missing env var {name}")
    return val


@lru_cache(maxsize=1)
def s3():
    import boto3

    return boto3.client("s3", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))


@lru_cache(maxsize=1)
def r2():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{_env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def work_bucket() -> str:
    return _env("CLIPPER_S3_BUCKET")


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"not an s3 uri: {uri}")
    bucket, _, key = uri[5:].partition("/")
    return bucket, key


# ---------- sources ----------

def upload_source(local: Path, source_id: str) -> str:
    key = f"sources/{source_id}/source{local.suffix.lower()}"
    s3().upload_file(str(local), work_bucket(), key)
    return f"s3://{work_bucket()}/{key}"


def download(uri: str, dest: Path) -> Path:
    """Fetch s3://bucket/key (AWS) or r2://bucket/key (Cloudflare R2, dashboard uploads)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if uri.startswith("r2://"):
        bucket, _, key = uri[5:].partition("/")
        r2().download_file(bucket, key, str(dest))
        return dest
    bucket, key = parse_s3_uri(uri)
    s3().download_file(bucket, key, str(dest))
    return dest


# ---------- resumable work dir ----------

def _remote_sizes(prefix: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for page in s3().get_paginator("list_objects_v2").paginate(Bucket=work_bucket(), Prefix=prefix):
        for obj in page.get("Contents", []):
            out[obj["Key"]] = obj["Size"]
    return out


def push_workdir(local: Path, source_id: str) -> int:
    prefix = f"work/{source_id}/"
    remote = _remote_sizes(prefix)
    n = 0
    for f in local.rglob("*"):
        if not f.is_file() or f.name in SKIP_SYNC:
            continue
        key = prefix + f.relative_to(local).as_posix()
        if remote.get(key) != f.stat().st_size:
            s3().upload_file(str(f), work_bucket(), key)
            n += 1
    return n


def pull_workdir(local: Path, source_id: str) -> int:
    prefix = f"work/{source_id}/"
    n = 0
    for key, size in _remote_sizes(prefix).items():
        dest = local / key[len(prefix):]
        if dest.exists() and dest.stat().st_size == size:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        s3().download_file(work_bucket(), key, str(dest))
        n += 1
    return n


# ---------- published clips (R2) ----------

def publish_clip(source_id: str, clip_id: str, video: Path, thumb: Path) -> dict[str, str]:
    bucket = _env("R2_BUCKET")
    vkey = f"clips/{source_id}/{clip_id}.mp4"
    tkey = f"clips/{source_id}/{clip_id}.jpg"
    r2().upload_file(str(video), bucket, vkey, ExtraArgs={"ContentType": "video/mp4"})
    r2().upload_file(str(thumb), bucket, tkey, ExtraArgs={"ContentType": "image/jpeg"})
    return {"video_key": vkey, "thumb_key": tkey}


def publish_full(source_id: str, video: Path, thumb: Path) -> dict[str, str | int]:
    """Keep the full (1080p, normalized) long-form video in R2 under full/<source>/.
    Idempotent: an object of the same size is already there on resumed runs, so it isn't re-uploaded."""
    bucket = _env("R2_BUCKET")
    vkey = f"full/{source_id}/full.mp4"
    tkey = f"full/{source_id}/full.jpg"
    size = video.stat().st_size
    try:
        existing = r2().head_object(Bucket=bucket, Key=vkey)["ContentLength"]
    except Exception:
        existing = None
    if existing != size:
        r2().upload_file(str(video), bucket, vkey, ExtraArgs={"ContentType": "video/mp4"})
    r2().upload_file(str(thumb), bucket, tkey, ExtraArgs={"ContentType": "image/jpeg"})
    return {"video_key": vkey, "thumb_key": tkey, "size": size}


def publish_render_inputs(source_id: str, clip_id: str, vertical: Path, props: Path) -> str:
    """Upload the reframed vertical video + render props so the header can be re-rendered on a CPU job."""
    bucket = _env("R2_BUCKET")
    prefix = f"render/{source_id}/{clip_id}/"
    r2().upload_file(str(vertical), bucket, prefix + "vertical.mp4", ExtraArgs={"ContentType": "video/mp4"})
    r2().upload_file(str(props), bucket, prefix + "props.json", ExtraArgs={"ContentType": "application/json"})
    return prefix
