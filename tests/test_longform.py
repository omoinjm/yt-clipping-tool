"""Keeping the full long-form video: R2 publish (idempotent) and registering it with the dashboard."""

import json

import boto3
from moto import mock_aws

from clipper import cli, ffmpeg, storage
from test_cloud import _Handler, api  # noqa: F401  (fixture)


def _r2(monkeypatch):
    """A moto S3 bucket standing in for R2, with upload_file calls counted."""
    monkeypatch.setenv("R2_BUCKET", "clips")
    client = boto3.client("s3", region_name="us-east-1")
    client.create_bucket(Bucket="clips")
    uploads: list[str] = []
    real = client.upload_file

    def counting(path, bucket, key, **kw):
        uploads.append(key)
        return real(path, bucket, key, **kw)

    client.upload_file = counting
    monkeypatch.setattr(storage, "r2", lambda: client)
    return client, uploads


@mock_aws
def test_publish_full_uploads_once_then_skips_same_size(tmp_path, monkeypatch):
    client, uploads = _r2(monkeypatch)
    video, thumb = tmp_path / "source.mp4", tmp_path / "full.jpg"
    video.write_bytes(b"v" * 1000)
    thumb.write_bytes(b"jpg")

    keys = storage.publish_full("ep1", video, thumb)
    assert keys == {"video_key": "full/ep1/full.mp4", "thumb_key": "full/ep1/full.jpg", "size": 1000}
    assert uploads == ["full/ep1/full.mp4", "full/ep1/full.jpg"]

    storage.publish_full("ep1", video, thumb)  # resumed run: same file already in R2
    assert uploads.count("full/ep1/full.mp4") == 1
    assert client.head_object(Bucket="clips", Key="full/ep1/full.mp4")["ContentLength"] == 1000

    video.write_bytes(b"v" * 2000)  # a different file (e.g. re-ingested) is uploaded again
    storage.publish_full("ep1", video, thumb)
    assert uploads.count("full/ep1/full.mp4") == 2


@mock_aws
def test_publish_full_registers_with_dashboard_using_download_metadata(tmp_path, monkeypatch, api):  # noqa: F811
    _r2(monkeypatch)
    (tmp_path / "source.mp4").write_bytes(b"v" * 10)
    (tmp_path / "source_meta.json").write_text(json.dumps({"title": "Ep 4: Startups", "description": "Full talk", "tags": ["a", "b"]}))
    monkeypatch.setattr(ffmpeg, "duration", lambda p: 3600.0)
    monkeypatch.setattr(ffmpeg, "thumbnail", lambda src, dst, at=1.0, width=540: dst.write_bytes(b"jpg"))

    cli._publish_full(api, "ep4", tmp_path)

    method, path, body, _ = _Handler.calls[-1]
    assert (method, path) == ("PUT", "/api/internal/sources/ep4/longform")
    assert body == {
        "video_key": "full/ep4/full.mp4", "thumb_key": "full/ep4/full.jpg", "size": 10, "duration": 3600.0,
        "title": "Ep 4: Startups", "description": "Full talk", "tags": ["a", "b"],
    }


def test_publish_full_never_fails_the_job(tmp_path, api, capsys):  # noqa: F811
    cli._publish_full(api, "missing", tmp_path)  # no source.mp4 at all
    assert "could not keep the full video" in capsys.readouterr().out
