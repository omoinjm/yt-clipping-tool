import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3
import pytest
from moto import mock_aws

from clipper import storage
from clipper.state import ApiState


class _Handler(BaseHTTPRequestHandler):
    calls: list = []

    def _reply(self, code=200, body=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if body is not None:
            self.wfile.write(json.dumps(body).encode())

    def _record(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        _Handler.calls.append((self.command, self.path, body, dict(self.headers)))

    def do_GET(self):
        self._record()
        if self.path == "/api/internal/sources/missing":
            return self._reply(404, {"error": "not found"})
        if self.path.startswith("/api/internal/clips"):
            return self._reply(200, [{"id": "a-01", "stage": "selected"}])
        self._reply(200, {"id": "a", "duration": 10})

    do_PUT = do_POST = do_PATCH = lambda self: (self._record(), self._reply(204))  # noqa: E731

    def log_message(self, *a):
        pass


@pytest.fixture()
def api():
    _Handler.calls = []
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield ApiState(f"http://127.0.0.1:{srv.server_port}", "tok", "cid", "csecret")
    srv.shutdown()


def test_api_state_routes_and_auth_headers(api):
    api.upsert_source(id="a", origin="s3://b/k", owner="us", permission="own")
    api.set_source_stage("a", "running", error=None)
    api.update_clip("a-01", stage="published", video_key="clips/a/a-01.mp4")
    assert api.clips("a", stage="selected") == [{"id": "a-01", "stage": "selected"}]
    assert api.source("a")["duration"] == 10

    methods_paths = [(m, p) for m, p, _, _ in _Handler.calls]
    assert methods_paths[:4] == [
        ("PUT", "/api/internal/sources/a"),
        ("POST", "/api/internal/sources/a/stage"),
        ("PATCH", "/api/internal/clips/a-01"),
        ("GET", "/api/internal/clips?source=a&stage=selected"),
    ]
    _, _, body, headers = _Handler.calls[1]
    assert body == {"stage": "running", "error": None}
    headers = {k.lower(): v for k, v in headers.items()}
    assert headers["authorization"] == "Bearer tok"
    assert headers["cf-access-client-id"] == "cid"


def test_api_state_missing_source_raises_keyerror(api):
    with pytest.raises(KeyError):
        api.source("missing")


@mock_aws
def test_workdir_push_pull_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    monkeypatch.setenv("CLIPPER_S3_BUCKET", "work")
    storage.s3.cache_clear()
    boto3.client("s3", region_name="eu-west-1").create_bucket(
        Bucket="work", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"})

    src = tmp_path / "src"
    (src / "clips" / "c1").mkdir(parents=True)
    (src / "transcript.json").write_text("{}")
    (src / "clips" / "c1" / "final.mp4").write_bytes(b"x" * 10)
    (src / "clips" / "c1" / "trim.mp4").write_bytes(b"skip me")

    assert storage.push_workdir(src, "ep") == 2
    assert storage.push_workdir(src, "ep") == 0  # unchanged → nothing re-uploaded

    dst = tmp_path / "dst"
    assert storage.pull_workdir(dst, "ep") == 2
    assert (dst / "clips" / "c1" / "final.mp4").read_bytes() == b"x" * 10
    assert not (dst / "clips" / "c1" / "trim.mp4").exists()


def test_parse_s3_uri():
    assert storage.parse_s3_uri("s3://bucket/a/b.mp4") == ("bucket", "a/b.mp4")
