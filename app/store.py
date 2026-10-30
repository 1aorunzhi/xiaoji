"""存档：SQLite。

为什么不用 localStorage 了：状态搬到后端之后，存档也得跟着搬，否则
刷新一次页面 Python 这边就断了。用 SQLite 的好处是它天生适合「一条宠物
+ 若干条记忆」这种一对多结构，而且换设备只要拷一个 .db 文件。

单用户场景下固定一条宠物记录（id = 1）；想养多只改成按 id 查询即可。
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
from contextlib import contextmanager

from . import config
from .domain import hygiene, memory
from .domain.pet import Pet

PET_ID = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS pets (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    born          INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL,
    feeds         INTEGER NOT NULL DEFAULT 0,
    exp           REAL    NOT NULL DEFAULT 0,
    mood          REAL    NOT NULL DEFAULT 68,
    traits        TEXT    NOT NULL DEFAULT '{}',
    full          REAL    NOT NULL DEFAULT 56,
    full_at       INTEGER NOT NULL DEFAULT 0,
    taste         TEXT    NOT NULL DEFAULT '{}',
    ate           TEXT    NOT NULL DEFAULT '[]',
    gut           REAL    NOT NULL DEFAULT 30,
    gut_at        INTEGER NOT NULL DEFAULT 0,
    poop          TEXT    NOT NULL DEFAULT '[]',
    cleaned       INTEGER NOT NULL DEFAULT 0,
    days_on       INTEGER NOT NULL DEFAULT 1,
    last_day      TEXT    NOT NULL DEFAULT '',
    history       TEXT    NOT NULL DEFAULT '[]',
    version       INTEGER NOT NULL DEFAULT 1,
    updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,
    pet_id      INTEGER NOT NULL,
    text        TEXT    NOT NULL,
    kind        TEXT    NOT NULL,
    intensity   INTEGER NOT NULL DEFAULT 3,
    ts          INTEGER NOT NULL,
    feed_at     INTEGER NOT NULL DEFAULT 0,
    settled     INTEGER NOT NULL DEFAULT 0,
    how         TEXT,
    settled_at  INTEGER,
    demand      TEXT,
    FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_pet ON memories(pet_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(pet_id, kind, settled);
"""


@contextmanager
def connect():
    os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def load() -> Pet | None:
    """读存档。没有就返回 None（前端会进入起名界面）。"""
    with connect() as conn:
        row = conn.execute("SELECT * FROM pets WHERE id = ?", (PET_ID,)).fetchone()
        if row is None:
            return None
        pet = Pet.from_dict(
            {
                "v": row["version"],
                "name": row["name"],
                "born": row["born"],
                "lastSeen": row["last_seen"],
                "feeds": row["feeds"],
                "exp": row["exp"],
                "mood": row["mood"],
                "traits": json.loads(row["traits"]),
                "history": json.loads(row["history"]),
                "daysOn": row["days_on"],
                "lastDay": row["last_day"],
                "full": row["full"],
                "fullAt": row["full_at"],
                "taste": json.loads(row["taste"]),
                "ate": json.loads(row["ate"]),
                "gut": row["gut"],
                "gutAt": row["gut_at"],
                "poop": json.loads(row["poop"]),
                "cleaned": row["cleaned"],
            }
        )
        rows = conn.execute(
            "SELECT * FROM memories WHERE pet_id = ? ORDER BY ts DESC", (PET_ID,)
        ).fetchall()
        pet.memories = [
            memory.Memory.from_dict(
                {
                    "id": r["id"],
                    "text": r["text"],
                    "kind": r["kind"],
                    "intensity": r["intensity"],
                    "ts": r["ts"],
                    "feedAt": r["feed_at"],
                    "settled": bool(r["settled"]),
                    "how": r["how"],
                    "settledAt": r["settled_at"],
                    "demand": json.loads(r["demand"]) if r["demand"] else None,
                }
            )
            for r in rows
        ]
    return pet


def save(pet: Pet, now: int = 0) -> None:
    payload = pet.to_dict()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO pets (id, name, born, last_seen, feeds, exp, mood, traits,
                              full, full_at, taste, ate, gut, gut_at, poop, cleaned,
                              days_on, last_day, history, version, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, born=excluded.born, last_seen=excluded.last_seen,
                feeds=excluded.feeds, exp=excluded.exp, mood=excluded.mood,
                traits=excluded.traits, full=excluded.full, full_at=excluded.full_at,
                taste=excluded.taste, ate=excluded.ate, gut=excluded.gut,
                gut_at=excluded.gut_at, poop=excluded.poop, cleaned=excluded.cleaned,
                days_on=excluded.days_on, last_day=excluded.last_day,
                history=excluded.history, version=excluded.version,
                updated_at=excluded.updated_at
            """,
            (
                PET_ID,
                pet.name,
                pet.born,
                pet.last_seen,
                pet.feeds,
                pet.exp,
                pet.mood,
                json.dumps(pet.traits, ensure_ascii=False),
                pet.full,
                pet.full_at,
                json.dumps(pet.taste, ensure_ascii=False),
                json.dumps(pet.ate, ensure_ascii=False),
                pet.gut,
                pet.gut_at,
                json.dumps([p.to_dict() for p in pet.poop], ensure_ascii=False),
                pet.cleaned,
                pet.days_on,
                pet.last_day,
                json.dumps(payload["history"], ensure_ascii=False),
                pet.v,
                now or pet.last_seen,
            ),
        )

        conn.execute("DELETE FROM memories WHERE pet_id = ?", (PET_ID,))
        conn.executemany(
            """
            INSERT INTO memories (id, pet_id, text, kind, intensity, ts, feed_at,
                                  settled, how, settled_at, demand)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    m.id,
                    PET_ID,
                    m.text,
                    m.kind,
                    m.intensity,
                    m.ts,
                    m.feed_at,
                    1 if m.settled else 0,
                    m.how,
                    m.settled_at,
                    json.dumps(m.demand, ensure_ascii=False) if m.demand else None,
                )
                for m in pet.memories
            ],
        )


def reset() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM memories WHERE pet_id = ?", (PET_ID,))
        conn.execute("DELETE FROM pets WHERE id = ?", (PET_ID,))


# ---------- 存档码：换设备用 ----------

def encode(pet: Pet) -> str:
    payload = pet.to_dict()
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return "XJ1-" + base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode(code: str) -> Pet | None:
    text = str(code or "").strip()
    if not text.startswith("XJ1-"):
        return None
    try:
        raw = base64.urlsafe_b64decode(text[4:].encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or "traits" not in data:
        return None
    pet = Pet.from_dict(data)
    pet.poop = [hygiene.Poop.from_dict(p) for p in (data.get("poop") or [])]
    return pet
