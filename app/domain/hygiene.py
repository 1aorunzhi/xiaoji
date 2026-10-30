"""吃了就得还：消化、拉到地上、被收拾。

这条链是接上的：
    喂 → 吃撑 → 攒消化 → 脚边拉 → 不收拾 → 掉心情 → 记仇
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .growth import clamp
from .memory import add_memory

HOUR = 3_600_000
POOP_MAX = 4
# 落点错开，别叠在一起
SLOTS: tuple[float, ...] = (-0.62, 0.5, -0.28, 0.78)


@dataclass
class Poop:
    id: str
    at: int
    x: float
    size: float

    def to_dict(self) -> dict:
        return {"id": self.id, "at": self.at, "x": self.x, "size": self.size}

    @classmethod
    def from_dict(cls, data: dict) -> "Poop":
        return cls(
            id=str(data.get("id", "")),
            at=int(data.get("at", 0) or 0),
            x=float(data.get("x", 0) or 0),
            size=float(data.get("size", 1) or 1),
        )


def digest(pet, now: int) -> None:
    """吃得越饱，走得越快。"""
    if pet.gut is None:
        pet.gut = 30
    last = pet.gut_at or pet.last_seen or now
    hours = (now - last) / HOUR
    pet.gut_at = now
    if hours <= 0:
        return
    speed = 6 + (pet.full / 100) * 12
    pet.gut = clamp(pet.gut + hours * speed, 0, 220)


def flush_poop(pet, now: int) -> list[Poop]:
    """到点了就拉一坨。地上堆满 4 坨它就憋着。"""
    digest(pet, now)
    made: list[Poop] = []
    while pet.gut >= 100 and len(pet.poop) < POOP_MAX:
        pet.gut -= 100
        made.append(
            Poop(
                id=f"p{now}{random.randint(0, 996)}",
                at=now,
                x=SLOTS[len(pet.poop) % len(SLOTS)],
                size=0.86 + random.random() * 0.34,
            )
        )
        pet.poop.append(made[-1])
    if len(pet.poop) >= POOP_MAX and pet.gut > 99:
        pet.gut = 99
    return made


def poop_penalty(pet, hours: float) -> float:
    """地上有东西不收拾，心情一点点烂下去。"""
    if not pet.poop:
        return 0.0
    drop = len(pet.poop) * min(7, 1.1 + hours * 0.85)
    pet.mood = clamp(pet.mood - drop, 0, 100)
    return drop


def clean_poop(pet, poop_id: str, now: int) -> dict | None:
    """收拾掉一坨。

    越早收拾越值钱；放久了它已经不高兴了，只值一句「算你还有点良心」。
    """
    index = next((i for i, p in enumerate(pet.poop) if p.id == poop_id), -1)
    if index < 0:
        return None

    poop = pet.poop.pop(index)
    hours = (now - poop.at) / HOUR
    quick = hours < 0.5
    exp = 6 if quick else 3
    mood = 7 if quick else 3

    pet.cleaned = (pet.cleaned or 0) + 1
    pet.exp += exp
    pet.mood = clamp(pet.mood + mood, 0, 100)
    pet.last_seen = now

    return {
        "poop": poop,
        "hours": hours,
        "quick": quick,
        "exp": exp,
        "mood": mood,
        "left": len(pet.poop),
    }


def poop_word(count: int) -> str:
    if not count:
        return "很干净"
    if count == 1:
        return "一坨"
    if count <= 3:
        return f"{count} 坨"
    return f"{count} 坨，它没地方下脚"


def poop_sick(pet, now: int):
    """堆太久又太多：这笔账得记上。

    同一件事只记一次，靠 add_memory 的去重兜底。
    """
    if len(pet.poop) < 3:
        return None
    oldest = min(pet.poop, key=lambda p: p.at)
    if now - oldest.at < 5 * HOUR:
        return None
    if any("踩在自己" in m.text for m in pet.memories):
        return None
    return add_memory(
        pet,
        "主人让我踩在自己拉的东西上，一直不收拾",
        kind="grudge",
        intensity=4,
        now=now,
    )
