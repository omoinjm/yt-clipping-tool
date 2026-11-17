"""Pipeline state backends: local SQLite, or the Cloudflare dashboard's internal API."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from typing import Any, Protocol

from .config import settings
from .db import DB


class State(Protocol):
    def upsert_source(self, **row: Any) -> None: ...
    def source(self, source_id: str) -> dict[str, Any]: ...
    def set_source_stage(self, source_id: str, stage: str, **extra: Any) -> None: ...
    def replace_clips(self, source_id: str, clips: list[dict[str, Any]]) -> None: ...
    def clips(self, source_id: str | None = None, stage: str | None = None) -> list[dict[str, Any]]: ...
    def update_clip(self, clip_id: str, **fields: Any) -> None: ...


class SqliteState:
    def __init__(self, db: DB):
        self.db = db

    def upsert_source(self, **row: Any) -> None:
        self.db.upsert_source(**row)

    def source(self, source_id: str) -> dict[str, Any]:
        return dict(self.db.source(source_id))

    def set_source_stage(self, source_id: str, stage: str, **extra: Any) -> None:
        self.db.set_source_stage(source_id, stage, **extra)

    def replace_clips(self, source_id: str, clips: list[dict[str, Any]]) -> None:
        self.db.replace_clips(source_id, clips)

    def clips(self, source_id: str | None = None, stage: str | None = None) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.clips(source_id, stage)]

    def update_clip(self, clip_id: str, **fields: Any) -> None:
        self.db.update_clip(clip_id, **fields)


class ApiError(RuntimeError):
    pass


class ApiState:
    """Talks to the dashboard Worker's /api/internal routes.

    Auth: Cloudflare Access service token headers (checked at the edge) plus a bearer token
    (checked by the Worker itself).
    """

    def __init__(self, base_url: str, token: str, access_id: str | None, access_secret: str | None):
        self.base = base_url.rstrip("/") + "/api/internal"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                        "User-Agent": "clipper-cli"}
        if access_id and access_secret:
            self.headers["CF-Access-Client-Id"] = access_id
            self.headers["CF-Access-Client-Secret"] = access_secret

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raise ApiError(f"{method} {path} → {e.code}: {e.read()[:500]!r}") from e
        return json.loads(raw) if raw else None

    def upsert_source(self, **row: Any) -> None:
        self._call("PUT", f"/sources/{row['id']}", row)

    def source(self, source_id: str) -> dict[str, Any]:
        try:
            return self._call("GET", f"/sources/{source_id}")
        except ApiError as e:
            if "→ 404" in str(e):
                raise KeyError(f"unknown source {source_id!r}") from e
            raise

    def set_source_stage(self, source_id: str, stage: str, **extra: Any) -> None:
        self._call("POST", f"/sources/{source_id}/stage", {"stage": stage, **extra})

    def replace_clips(self, source_id: str, clips: list[dict[str, Any]]) -> None:
        self._call("PUT", f"/sources/{source_id}/clips", clips)

    def clips(self, source_id: str | None = None, stage: str | None = None) -> list[dict[str, Any]]:
        q = urllib.parse.urlencode({k: v for k, v in {"source": source_id, "stage": stage}.items() if v})
        return self._call("GET", f"/clips?{q}")

    def update_clip(self, clip_id: str, **fields: Any) -> None:
        self._call("PATCH", f"/clips/{clip_id}", fields)

    def yt_cookies(self) -> str | None:
        """YouTube cookies.txt saved in the dashboard (Settings), or None if none is set."""
        req = urllib.request.Request(self.base + "/settings/yt-cookies", headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode()
        except urllib.error.HTTPError as e:
            raise ApiError(f"GET /settings/yt-cookies → {e.code}") from e
        return text.strip() or None


@lru_cache(maxsize=1)
def get_state() -> State:
    if os.environ.get("CLIPPER_STATE", "sqlite") == "api":
        url, token = os.environ.get("CLIPPER_API_URL"), os.environ.get("CLIPPER_API_TOKEN")
        if not (url and token):
            raise RuntimeError("CLIPPER_STATE=api needs CLIPPER_API_URL and CLIPPER_API_TOKEN")
        return ApiState(url, token, os.environ.get("CF_ACCESS_CLIENT_ID"), os.environ.get("CF_ACCESS_CLIENT_SECRET"))
    return SqliteState(DB(settings.db_path))
