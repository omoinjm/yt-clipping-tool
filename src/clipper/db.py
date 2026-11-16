"""Tiny SQLite state store so every stage is resumable."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id          TEXT PRIMARY KEY,
    origin      TEXT NOT NULL,          -- url or local path
    owner       TEXT NOT NULL,
    permission  TEXT NOT NULL,          -- own | granted | cc_by
    proof       TEXT,
    credit      TEXT,
    duration    REAL,
    stage       TEXT NOT NULL DEFAULT 'new',
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clips (
    id           TEXT PRIMARY KEY,      -- <source_id>-<n>
    source_id    TEXT NOT NULL REFERENCES sources(id),
    start        REAL NOT NULL,
    end          REAL NOT NULL,
    score        REAL,
    hook         TEXT,
    title        TEXT,
    description  TEXT,
    tags         TEXT,                  -- json list
    reason       TEXT,
    stage        TEXT NOT NULL DEFAULT 'selected',
    output_path  TEXT,
    youtube_id   TEXT,
    error        TEXT,
    duration     REAL,
    layout       TEXT,
    video_key    TEXT,
    thumb_key    TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


class DB:
    def __init__(self, path: Path):
        self.path = path
        with self.conn() as c:
            c.executescript(SCHEMA)
            have = {r["name"] for r in c.execute("PRAGMA table_info(clips)")}
            for col, typ in (("duration", "REAL"), ("layout", "TEXT"), ("video_key", "TEXT"), ("thumb_key", "TEXT")):
                if col not in have:
                    c.execute(f"ALTER TABLE clips ADD COLUMN {col} {typ}")

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    # sources
    def upsert_source(self, **row: Any) -> None:
        cols = ", ".join(row)
        qs = ", ".join("?" for _ in row)
        updates = ", ".join(f"{k}=excluded.{k}" for k in row if k != "id")
        with self.conn() as c:
            c.execute(
                f"INSERT INTO sources ({cols}) VALUES ({qs}) ON CONFLICT(id) DO UPDATE SET {updates}",
                tuple(row.values()),
            )

    def source(self, source_id: str) -> sqlite3.Row:
        with self.conn() as c:
            row = c.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown source {source_id!r}; run `clipper ingest` first")
        return row

    def set_source_stage(self, source_id: str, stage: str, **extra: Any) -> None:
        sets = ", ".join(["stage=?"] + [f"{k}=?" for k in extra])
        with self.conn() as c:
            c.execute(f"UPDATE sources SET {sets} WHERE id=?", (stage, *extra.values(), source_id))

    # clips
    def replace_clips(self, source_id: str, clips: list[dict[str, Any]]) -> None:
        with self.conn() as c:
            c.execute("DELETE FROM clips WHERE source_id=? AND youtube_id IS NULL", (source_id,))
            for clip in clips:
                c.execute(
                    """INSERT OR REPLACE INTO clips
                       (id, source_id, start, end, score, hook, title, description, tags, reason)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        clip["id"], source_id, clip["start"], clip["end"], clip.get("score"),
                        clip.get("hook"), clip.get("title"), clip.get("description"),
                        json.dumps(clip.get("tags", [])), clip.get("reason"),
                    ),
                )

    def clips(self, source_id: str | None = None, stage: str | None = None) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM clips WHERE 1=1", []
        if source_id:
            q += " AND source_id=?"
            args.append(source_id)
        if stage:
            q += " AND stage=?"
            args.append(stage)
        with self.conn() as c:
            return c.execute(q + " ORDER BY source_id, score DESC", args).fetchall()

    def update_clip(self, clip_id: str, **fields: Any) -> None:
        sets = ", ".join(f"{k}=?" for k in fields)
        with self.conn() as c:
            c.execute(f"UPDATE clips SET {sets} WHERE id=?", (*fields.values(), clip_id))
