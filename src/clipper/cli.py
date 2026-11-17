"""clipper CLI: long-form video → captioned YouTube Shorts.

Local mode (default): everything runs on this machine, state in SQLite.
Cloud mode: `submit` sends a source to AWS Batch (GPU); `cloud-run` is what the Batch container runs;
clips land in R2 and show up in the Cloudflare dashboard.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import typer

from . import ffmpeg, pipeline
from . import sources as sources_mod
from .config import settings
from .state import ApiState, get_state

app = typer.Typer(no_args_is_help=True, add_completion=False)


def _source_row(src: sources_mod.Source, origin: str | None = None) -> dict:
    return {"id": src.id, "origin": origin or src.origin, "owner": src.owner, "permission": src.permission,
            "proof": src.proof, "credit": src.credit}


def _registered(source_id: str) -> sources_mod.Source:
    src = sources_mod.load(settings.sources_file).get(source_id)
    if src is None:
        raise typer.BadParameter(f"{source_id!r} not in {settings.sources_file}")
    sources_mod.check_permission(src)
    return src


# ───────────────────────── local pipeline ─────────────────────────

@app.command()
def ingest(source_id: str, force: bool = False) -> None:
    """Permission-check, download/copy and normalize a source from sources.yaml."""
    src = _registered(source_id)
    wd = pipeline.workdir(source_id)
    raw = wd / "source.mp4" if (wd / "source.mp4").exists() and not force else sources_mod.fetch(src, wd)
    pipeline.ingest(get_state(), _source_row(src), raw, force=force)


@app.command()
def transcribe(source_id: str, diarize: bool = False, force: bool = False) -> None:
    """WhisperX transcript with word timestamps."""
    pipeline.transcribe(get_state(), source_id, diarize=diarize, force=force)


@app.command()
def scenes(source_id: str, force: bool = False) -> None:
    """PySceneDetect shot boundaries."""
    pipeline.scenes(get_state(), source_id, force=force)


@app.command()
def select(source_id: str, n: int = typer.Option(None, help="clips to keep"), force: bool = True) -> None:
    """Ask Claude for the best moments; snap and store candidates."""
    pipeline.select(get_state(), source_id, n=n, force=force)


@app.command()
def produce(source_id: str, clip: str = typer.Option(None, help="only this clip id"),
            tighten: bool = True, force: bool = False) -> None:
    """Cut → auto-editor → re-transcribe → reframe → Remotion render, per clip."""
    pipeline.produce(get_state(), source_id, clip=clip, tighten=tighten, force=force)


@app.command()
def run(source_id: str, n: int = typer.Option(None), do_upload: bool = typer.Option(False, "--upload")) -> None:
    """Full pipeline for one source, on this machine."""
    ingest(source_id, force=False)
    pipeline.transcribe(get_state(), source_id)
    pipeline.scenes(get_state(), source_id)
    pipeline.select(get_state(), source_id, n=n)
    pipeline.produce(get_state(), source_id)
    if do_upload:
        upload(source_id, clip=None, privacy="private")


@app.command()
def upload(source_id: str, clip: str = typer.Option(None), privacy: str = "private") -> None:
    """Upload locally rendered clips to YouTube (private by default)."""
    from .upload import build_description, upload as yt_upload

    state = get_state()
    src = state.source(source_id)
    for r in state.clips(source_id, stage="rendered"):
        if clip and r["id"] != clip:
            continue
        tags = json.loads(r["tags"] or "[]")
        desc = build_description(r["description"] or "", src["credit"], tags)
        vid = yt_upload(Path(r["output_path"]), r["title"], desc, tags, privacy)
        state.update_clip(r["id"], stage="uploaded", youtube_id=vid)
        typer.echo(f"✓ {r['id']} → https://youtube.com/shorts/{vid} ({privacy})")


@app.command("list")
def list_clips(source_id: str = typer.Argument(None)) -> None:
    """Show clips and their status."""
    for r in get_state().clips(source_id):
        yt = f" yt={r['youtube_id']}" if r.get("youtube_id") else ""
        typer.echo(f"{r['id']:18} {r['stage']:9} {r['score'] or 0:3.0f} "
                   f"{r['end'] - r['start']:5.1f}s  {r['title']}{yt}")


# ───────────────────────── cloud ─────────────────────────

def _api() -> ApiState:
    url, token = os.environ.get("CLIPPER_API_URL"), os.environ.get("CLIPPER_API_TOKEN")
    if not (url and token):
        raise typer.BadParameter("set CLIPPER_API_URL and CLIPPER_API_TOKEN in .env (see README: Cloud)")
    return ApiState(url, token, os.environ.get("CF_ACCESS_CLIENT_ID"), os.environ.get("CF_ACCESS_CLIENT_SECRET"))


@app.command()
def submit(source_id: str, n: int = typer.Option(None, help="clips to keep")) -> None:
    """Send a source to AWS Batch (GPU). Clips appear in the dashboard when done."""
    import boto3

    from . import storage

    src = _registered(source_id)
    api = _api()
    if src.path:
        local = Path(src.path).expanduser()
        typer.echo(f"uploading {local.name} ({local.stat().st_size / 1e6:.0f} MB) to S3…")
        origin = storage.upload_source(local, source_id)
    else:
        origin = src.url  # downloaded by yt-dlp inside the job
    api.upsert_source(**_source_row(src, origin), stage="queued")

    env = [{"name": "CLIPS_PER_SOURCE", "value": str(n or settings.clips_per_source)}]
    job = boto3.client("batch").submit_job(
        jobName=f"clipper-{source_id}",
        jobQueue=os.environ.get("CLIPPER_BATCH_QUEUE", "clipper-gpu"),
        jobDefinition=os.environ.get("CLIPPER_BATCH_JOBDEF", "clipper"),
        containerOverrides={"command": ["cloud-run", source_id], "environment": env},
    )
    api.set_source_stage(source_id, "queued", batch_job_id=job["jobId"])
    typer.echo(f"✓ submitted {source_id} → Batch job {job['jobId']}")


@app.command("cloud-run")
def cloud_run(source_id: str) -> None:
    """Runs inside the Batch container: resume from S3, process on GPU, publish clips to R2."""
    from . import storage

    state = get_state()
    row = state.source(source_id)
    wd = pipeline.workdir(source_id)
    pipeline.log(f"restored {storage.pull_workdir(wd, source_id)} files from S3")
    state.set_source_stage(source_id, "running", error=None)

    def checkpoint() -> None:
        storage.push_workdir(wd, source_id)

    def publish(clip_row: dict, final: Path) -> dict:
        thumb = final.with_suffix(".jpg")
        ffmpeg.thumbnail(final, thumb, at=min(1.0, ffmpeg.duration(final) / 2))
        keys = storage.publish_clip(source_id, clip_row["id"], final, thumb)
        return {**keys, "stage": "published"}

    try:
        if not (wd / "source.mp4").exists():
            origin = row["origin"]
            src = sources_mod.Source(id=source_id, owner=row["owner"], permission=row["permission"],
                                     url=None if origin.startswith(("s3://", "r2://")) else origin,
                                     path=origin if origin.startswith(("s3://", "r2://")) else None,
                                     proof=row.get("proof"), credit=row.get("credit"))
            sources_mod.check_permission(src)  # re-checked in the job: the dashboard is not trusted blindly
            if origin.startswith(("s3://", "r2://")):
                raw = storage.download(origin, wd / ("download" + Path(origin).suffix))
            else:
                raw = sources_mod.fetch(src, wd)  # verifies the CC BY license for cc_by sources
            pipeline.ingest(state, {k: row[k] for k in ("id", "origin", "owner", "permission", "proof", "credit")}, raw)
            raw.unlink(missing_ok=True)
            checkpoint()
        pipeline.transcribe(state, source_id)
        checkpoint()
        pipeline.scenes(state, source_id)
        checkpoint()
        pipeline.select(state, source_id, force=False)
        checkpoint()
        failures = pipeline.produce(state, source_id, on_rendered=publish)
        checkpoint()
    except Exception as e:
        state.set_source_stage(source_id, "failed", error=str(e)[:2000])
        raise
    clips = state.clips(source_id)
    if clips and failures == len(clips):
        sys.exit(1)


@app.command()
def jobs() -> None:
    """Cloud sources and their status."""
    for s in _api()._call("GET", "/sources"):
        typer.echo(f"{s['id']:20} {s['stage']:11} clips={s.get('clip_count', 0):<3} {s.get('error') or ''}")


if __name__ == "__main__":
    app()
