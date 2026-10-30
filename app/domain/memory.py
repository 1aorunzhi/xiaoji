"""记忆：它脑子里存着的事。

三类记忆：
    grudge  —— 主人欠它的账
    promise —— 主人答应过的事
    fact    —— 关于主人的稳定事实

仇只记不消。要消，得靠 grudges.pay_off()。
"""

from __future__ import annotations

from dataclasses import dataclass, field

HOUR = 3_600_000
DAY = 24 * HOUR
MAX_MEMORIES = 40

GRUDGE = "grudge"
PROMISE = "promise"
FACT = "fact"


@dataclass
class Memory:
    id: str
    text: str
    kind: str = FACT
    intensity: int = 3
    ts: int = 0
    feed_at: int = 0
    settled: bool = False
    how: str | None = None
    settled_at: int | None = None
    demand: dict | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "kind": self.kind,
            "intensity": self.intensity,
            "ts": self.ts,
            "feedAt": self.feed_at,
            "settled": self.settled,
            "how": self.how,
            "settledAt": self.settled_at,
            "demand": self.demand,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Memory":
        return cls(
            id=str(data.get("id", "")),
            text=str(data.get("text", "")),
            kind=data.get("kind", FACT) if data.get("kind") in (GRUDGE, PROMISE) else FACT,
            intensity=int(data.get("intensity", 3) or 3),
            ts=int(data.get("ts", 0) or 0),
            feed_at=int(data.get("feedAt", data.get("feed_at", 0)) or 0),
            settled=bool(data.get("settled", False)),
            how=data.get("how"),
            settled_at=data.get("settledAt"),
            demand=data.get("demand"),
        )


def similarity(a: str, b: str) -> float:
    """按字符集重合度粗算相似度，够用来去重和回找。"""
    if not a or not b:
        return 0.0
    set_b = set(b)
    set_a = set(a)
    if not set_a:
        return 0.0
    hit = sum(1 for ch in set_a if ch in set_b)
    return hit / max(len(set_a), 1)


def active_grudges(pet) -> list[Memory]:
    return [m for m in pet.memories if m.kind == GRUDGE and not m.settled]


def add_memory(pet, text: str, kind: str = FACT, intensity: int = 3, now: int = 0) -> Memory | None:
    """记下一件事。

    意思太像的会合并（把强度 +1、时间刷新），不会长出一堆重复条目。
    返回新建的那条；被合并或内容为空时返回 None。
    """
    clean = str(text or "").strip()[:60]
    if not clean:
        return None

    kind = kind if kind in (GRUDGE, PROMISE) else FACT

    for existing in pet.memories:
        same_text = existing.text == clean
        similar_enough = existing.kind == kind and similarity(existing.text, clean) > 0.72
        if same_text or similar_enough:
            existing.intensity = min(5, existing.intensity + 1)
            existing.ts = now
            return None

    import random

    memory = Memory(
        id=f"m{now}{random.randint(0, 998)}",
        text=clean,
        kind=kind,
        intensity=int(min(5, max(1, intensity or 3))),
        ts=now,
        feed_at=pet.feeds,
    )
    pet.memories.insert(0, memory)
    del pet.memories[MAX_MEMORIES:]
    return memory


def settle_grudges(pet) -> bool:
    """时间会淡化旧账：喂得够多，那笔账就不再提了。

    开过价的账更难忘——每加一次价，就得多喂五顿。
    """
    changed = False
    for memory in pet.memories:
        if memory.kind != GRUDGE or memory.settled:
            continue
        tier = memory.demand["tier"] if memory.demand else 0
        need = 5 + (memory.intensity or 3) + tier * 5
        if pet.feeds - memory.feed_at >= need:
            memory.settled = True
            memory.how = "faded"
            changed = True
    return changed


def match_grudge(pet, snippet: str) -> Memory | None:
    """模型抄回来的原文片段 → 找回对应的那条账。"""
    text = str(snippet or "").strip()
    if not text:
        return None
    best: Memory | None = None
    best_score = 0.0
    for grudge in active_grudges(pet):
        if grudge.text in text or text in grudge.text:
            score = 1.0
        else:
            score = similarity(grudge.text, text)
        if score > best_score:
            best_score = score
            best = grudge
    return best if best_score >= 0.5 else None


def ago_text(ts: int, now: int) -> str:
    delta = now - ts
    if delta < 60_000:
        return "刚刚"
    if delta < HOUR:
        return f"{delta // 60_000} 分钟前"
    if delta < DAY:
        return f"{delta // HOUR} 小时前"
    return f"{delta // DAY} 天前"


def grudge_age(ts: int, now: int) -> str:
    delta = now - ts
    if delta < DAY:
        return "耿耿于怀"
    return f"记了 {delta // DAY} 天"
