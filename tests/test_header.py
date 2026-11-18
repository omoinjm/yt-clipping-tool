"""Header styles reach the Remotion props; a flaky font load is retried once."""

import json
import subprocess

from clipper import render


def _fake_env(tmp_path, monkeypatch, outcomes):
    rdir = tmp_path / "remotion"
    (rdir / "node_modules").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(render, "settings", type("S", (), {"remotion_dir": rdir})())
    monkeypatch.setattr(render.ffmpeg, "duration", lambda p: 12.0)
    calls = []

    def fake(rdir_, out, props_path):
        calls.append(json.loads(props_path.read_text()))
        return subprocess.CompletedProcess([], outcomes[len(calls) - 1], "", "font timeout")

    monkeypatch.setattr(render, "_remotion", fake)
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    return video, calls


def test_header_style_is_passed_to_remotion(tmp_path, monkeypatch):
    video, calls = _fake_env(tmp_path, monkeypatch, [0])
    style = {"font": "Anton", "box": "none", "strokeWidth": 16}
    render.render("c1", video, [{"word": "hi", "start": 0, "end": 0.5}], "Hi *there*", tmp_path / "final.mp4", header=style)
    assert calls[0]["header"] == style and calls[0]["hook"] == "Hi *there*"


def test_no_header_means_default_preset(tmp_path, monkeypatch):
    video, calls = _fake_env(tmp_path, monkeypatch, [0])
    render.render("c1", video, [], "Hook", tmp_path / "final.mp4")
    assert "header" not in calls[0]


def test_render_retries_once_then_fails(tmp_path, monkeypatch):
    video, calls = _fake_env(tmp_path, monkeypatch, [1, 0])
    render.render("c1", video, [], "Hook", tmp_path / "final.mp4")  # second attempt succeeds
    assert len(calls) == 2
    video, calls = _fake_env(tmp_path, monkeypatch, [1, 1])
    try:
        render.render("c1", video, [], "Hook", tmp_path / "final.mp4")
        raise AssertionError("expected a failure")
    except RuntimeError as e:
        assert "font timeout" in str(e) and len(calls) == 2
