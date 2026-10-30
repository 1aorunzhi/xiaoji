"""宠物本体：状态容器 + 高层行为。

纯数据在这里，规则在同目录的 growth / foods / memory / grudges / hygiene 里。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import foods, growth, grudges, hygiene, memory

SAVE_VERSION = 1
HOUR = 3_600_000
DAY = 24 * HOUR
MAX_HISTORY = 20

DEFAULT_TRAITS = {"sharp": 58, "calm": 44, "social": 40}


def now_ms() -> int:
    return int(time.time() * 1000)


def day_key(ts: int) -> str:
    lt = time.localtime(ts / 1000)
    return f"{lt.tm_year}-{lt.tm_mon}-{lt.tm_mday}"


def start_of_day(ts: int) -> int:
    lt = time.localtime(ts / 1000)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000)


@dataclass
class Pet:
    name: str = "小记"
    born: int = 0
    last_seen: int = 0
    feeds: int = 0
    exp: float = 0
    mood: float = 68
    traits: dict = field(default_factory=lambda: dict(DEFAULT_TRAITS))
    memories: list[memory.Memory] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    days_on: int = 1
    last_day: str = ""
    idle_pinged: bool = False
    full: float = 56
    full_at: int = 0
    taste: dict = field(default_factory=dict)
    ate: list[str] = field(default_factory=list)
    gut: float = 30
    gut_at: int = 0
    poop: list[hygiene.Poop] = field(default_factory=list)
    cleaned: int = 0
    v: int = SAVE_VERSION

    # ---------- 构造 ----------

    @classmethod
    def create(cls, name: str = "小记", now: int | None = None) -> "Pet":
        now = now or now_ms()
        return cls(
            name=(name or "小记").strip()[:6] or "小记",
            born=now,
            last_seen=now,
            days_on=1,
            last_day=day_key(now),
            full_at=now,
            gut_at=now,
            taste=foods.roll_taste(now),
        )

    # ---------- 序列化 ----------

    def to_dict(self) -> dict:
        return {
            "v": self.v,
            "name": self.name,
            "born": self.born,
            "lastSeen": self.last_seen,
            "feeds": self.feeds,
            "exp": self.exp,
            "mood": self.mood,
            "traits": dict(self.traits),
            "memories": [m.to_dict() for m in self.memories],
            "history": list(self.history),
            "daysOn": self.days_on,
            "lastDay": self.last_day,
            "idlePinged": self.idle_pinged,
            "full": self.full,
            "fullAt": self.full_at,
            "taste": dict(self.taste),
            "ate": list(self.ate),
            "gut": self.gut,
            "gutAt": self.gut_at,
            "poop": [p.to_dict() for p in self.poop],
            "cleaned": self.cleaned,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Pet":
        """老存档没有的字段在这里补齐。口味必须由出生时间推出来，不能每次随机构造。"""
        born = int(data.get("born") or now_ms())
        pet = cls(
            name=str(data.get("name") or "小记")[:6],
            born=born,
            last_seen=int(data.get("lastSeen") or born),
            feeds=int(data.get("feeds") or 0),
            exp=float(data.get("exp") or 0),
            mood=float(data.get("mood", 68)),
            traits={**DEFAULT_TRAITS, **(data.get("traits") or {})},
            history=list(data.get("history") or []),
            days_on=int(data.get("daysOn") or 1),
            last_day=str(data.get("lastDay") or day_key(born)),
            idle_pinged=bool(data.get("idlePinged")),
            cleaned=int(data.get("cleaned") or 0),
            v=int(data.get("v") or SAVE_VERSION),
        )
        pet.full = float(data.get("full", 56))
        pet.full_at = int(data.get("fullAt") or pet.last_seen)
        pet.taste = data.get("taste") or foods.roll_taste(born)
        pet.ate = list(data.get("ate") or [])
        pet.gut = float(data.get("gut", 30))
        pet.gut_at = int(data.get("gutAt") or pet.last_seen)
        pet.poop = [hygiene.Poop.from_dict(p) for p in (data.get("poop") or [])]
        pet.memories = [memory.Memory.from_dict(m) for m in (data.get("memories") or [])]
        return pet

    # ---------- 派生属性 ----------

    @property
    def level(self) -> int:
        return growth.level_of(self.exp)

    @property
    def weight(self) -> int:
        return growth.weight_of(self.exp)

    @property
    def stage(self) -> str:
        return growth.stage_of(self.level)

    @property
    def title(self) -> str:
        return growth.title_of(self.traits)

    def to_state(self, now: int | None = None) -> dict:
        """给前端的一整包状态。前端只负责画，不再自己算任何数值。"""
        now = now or now_ms()
        next_exp = growth.exp_to_next(self.exp)
        return {
            "name": self.name,
            "level": self.level,
            "weight": self.weight,
            "stage": self.stage,
            "title": self.title,
            "exp": round(self.exp),
            "expNext": next_exp,
            "expPercent": round(growth.exp_progress(self.exp), 1),
            "mood": round(self.mood),
            "moodWord": growth.mood_word(self.mood),
            "moodShort": growth.mood_label_short(self.mood),
            "traitHint": growth.trait_hint(self.traits),
            "traits": {k: round(v) for k, v in self.traits.items()},
            "feeds": self.feeds,
            "daysOn": self.days_on,
            "full": round(self.full),
            "fullWord": foods.full_word(self.full),
            "fullPercent": round(self.full),
            "tasteText": foods.taste_text(self),
            "ate": list(self.ate),
            # 食盆上每个东西：它爱不爱吃、喂过没有（喂过才露馅）
            "foods": [
                {
                    "id": f.id,
                    "name": f.name,
                    "note": f.note,
                    "exp": f.exp,
                    "taste": foods.taste_of(self, f.id),
                    "known": f.id in self.ate,
                }
                for f in foods.FOODS
            ],
            "poop": [p.to_dict() for p in self.poop],
            "poopWord": hygiene.poop_word(len(self.poop)),
            "cleaned": self.cleaned,
            "statusline": (
                f"还差 {next_exp} 点经验升级 · {growth.mood_label_short(self.mood)}"
                if next_exp > 0
                else f"已经长到头了 · {growth.mood_label_short(self.mood)}"
            ),
            "dirty": f" · 地上 {len(self.poop)} 坨没收拾" if len(self.poop) >= 3 else "",
            "memories": [
                {**m.to_dict(), "howText": grudges.how_text(m, now)} for m in self.memories
            ],
            "agoText": memory.ago_text(self.last_seen, now),
        }

    # ---------- 时间 ----------

    def apply_offline(self, now: int | None = None) -> dict:
        """离开这段时间里发生的事：饿下去、攒出来、心情掉、跨天计数。"""
        now = now or now_ms()
        away = now - self.last_seen
        hours = away / HOUR

        foods.drain_full(self, now)
        hygiene.flush_poop(self, now)

        # 离开越久越不高兴，但第一次回来不至于归零
        if hours > 2.5:
            drop = min(46, (hours - 2.5) * 2.4)
            self.mood = growth.clamp(self.mood - drop, 0, 100)

        # 地上那几坨也在等你
        hygiene.poop_penalty(self, hours)

        today = day_key(now)
        if self.last_day != today:
            gap = int((start_of_day(now) - start_of_day(self.last_seen)) / DAY)
            if gap >= 1:
                self.days_on += gap
            self.last_day = today

        self.last_seen = now
        return {"away_hours": hours, "away_days": away / DAY}

    # ---------- 喂一句话 ----------

    def feed_text(self, text: str, now: int | None = None) -> dict:
        now = now or now_ms()
        length = len(text.strip())
        gain = 12 + min(50, length) * 0.4
        before = self.level

        self.feeds += 1
        self.exp += gain
        self.mood = growth.clamp(self.mood + 5, 0, 100)
        self.last_seen = now
        self.history.append({"role": "user", "content": text, "ts": now})
        self.trim_history()

        return {
            "gain": round(gain),
            "level_up": self.level > before,
            "level": self.level,
            "weight": self.weight,
        }

    # ---------- 对话记录 ----------

    def push_reply(self, content: str, hidden: bool = False, now: int | None = None) -> None:
        entry = {"role": "assistant", "content": content, "ts": now or now_ms()}
        if hidden:
            entry["hidden"] = True
        self.history.append(entry)
        self.trim_history()

    def push_hidden_user(self, content: str, now: int | None = None) -> None:
        """只给模型看的旁白，不进聊天气泡。"""
        self.history.append(
            {"role": "user", "content": content, "ts": now or now_ms(), "hidden": True}
        )
        self.trim_history()

    def trim_history(self) -> None:
        if len(self.history) > MAX_HISTORY:
            self.history = self.history[-MAX_HISTORY:]

    def messages(self, limit: int = 10) -> list[dict]:
        return [
            {"role": m["role"], "content": m["content"]}
            for m in self.history[-limit:]
            if m.get("content")
        ]

    def last_assistant_text(self) -> str:
        for entry in reversed(self.history):
            if entry.get("role") == "assistant":
                return entry.get("content", "")
        return ""

    # ---------- 记仇的便利方法 ----------

    def active_grudges(self):
        return memory.active_grudges(self)

    def pending_deal(self):
        return grudges.pending_deal(self)

    def add_memory(self, text: str, kind: str = memory.FACT, intensity: int = 3, now: int | None = None):
        return memory.add_memory(self, text, kind, intensity, now or now_ms())
