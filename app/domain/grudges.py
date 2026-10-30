"""索赔：道歉不算数，得赔。

规则是「道歉 = 开欠条，不是还款」：
    第一次道歉 → 当场开价
    第二次道歉 → 加价
    第三次道歉 → 再加价（三级封顶）
    东西真到手 → 划账

加价才是它的天赋。所以同一个「对不起」，道得越多，代价越贵。
"""

from __future__ import annotations

import re

from .growth import clamp
from .memory import GRUDGE, Memory, active_grudges

# 每一档都是三级台阶：先开价，再提价，最后翻倍
DEMAND_LADDERS: tuple[tuple[str, str, str], ...] = (
    ("三块小鱼干", "一整条三文鱼", "一条三文鱼，外加摸头十分钟"),
    ("一顿罐头", "两顿罐头", "三顿罐头，一顿都不能少"),
    ("十句好话", "三十句好话，得当面说", "一百句好话，还要录音"),
    ("一根猫条", "三根猫条", "一整盒猫条，拆开一根根喂"),
    ("陪它玩十分钟", "陪它玩半小时，不许看手机", "陪它一整晚，手机扔远点"),
    ("一个抱抱", "抱满五分钟", "抱着它睡一觉"),
    ("当面认输一次", "当着别人的面认输", "写下「我输了」贴在它窝边"),
)

APOLOGY_RE = re.compile(
    "对不起|抱歉|我错了|知道错了|认个错|认错|是我不对|我不该|不该那么|"
    "别生气|别气了|消消气|原谅我|道个歉|道歉|对不住|怪我|我检讨"
)

# 主人这一轮像是真的把东西给了（"已经给过"的语气，不是"以后给"）
GIVEN_RE = re.compile(
    "买了|买回来|给你买|我给你带|带回来了|拿来了|拿过来了|放桌上了|放你面前|"
    "搁你面前|请你吃|给你弄了|已经给你|给你准备了|赔你|补给|抱你|抱抱你|"
    "陪你(玩|半|一|坐|待)"
)
LATER_RE = re.compile("明天|下次|改天|待会|等会|一会儿|晚点|以后|回头|过两天")


def is_apology(text: str) -> bool:
    return bool(APOLOGY_RE.search(str(text or "")))


def looks_paid(text: str) -> bool:
    s = str(text or "")
    return bool(GIVEN_RE.search(s)) and not LATER_RE.search(s)


def hash_str(s: str) -> int:
    """决定这笔账走哪条梯子。用字符串哈希，保证同一件事永远要同一样东西。"""
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def pending_deal(pet) -> Memory | None:
    """还挂着条件、等着主人兑现的那笔账。"""
    with_demand = [g for g in active_grudges(pet) if g.demand]
    if not with_demand:
        return None
    return max(with_demand, key=lambda g: g.intensity)


def open_debt(pet) -> Memory | None:
    """记着但还没开价的那笔。"""
    for grudge in active_grudges(pet):
        if not grudge.demand:
            return grudge
    return None


def raise_demand(pet, target: Memory | None = None, now: int = 0) -> dict | None:
    """它开口要补偿。同一条账再提一次就加价。"""
    grudge = target
    if grudge is None:
        candidates = sorted(active_grudges(pet), key=lambda g: g.intensity, reverse=True)
        grudge = candidates[0] if candidates else None
    if grudge is None:
        return None

    ladder_index = hash_str(grudge.text) % len(DEMAND_LADDERS)
    before = grudge.demand["tier"] if grudge.demand else 0
    tier = min(3, before + 1)
    grudge.demand = {
        "ladder": ladder_index,
        "tier": tier,
        "text": DEMAND_LADDERS[ladder_index][tier - 1],
    }
    grudge.intensity = int(clamp((grudge.intensity or 3) + 1, 1, 5))
    grudge.ts = now

    return {
        "grudge": grudge,
        "tier": tier,
        "escalated": before > 0,
        "capped": before >= 3,
    }


def pay_off(grudge: Memory | None, now: int = 0) -> bool:
    """条件真兑现了才算翻篇。这是唯一能正常让它松口的途径。"""
    if grudge is None or grudge.settled:
        return False
    grudge.settled = True
    grudge.how = "paid"
    grudge.settled_at = now
    return True


def how_text(memory: Memory, now: int) -> str:
    from .memory import grudge_age

    if not memory.settled:
        return grudge_age(memory.ts, now)
    if memory.how == "paid":
        return "赔清了"
    if memory.how == "faded":
        return "懒得计较"
    return "已释怀"


def demand_text(memory: Memory | None) -> str:
    return memory.demand["text"] if memory and memory.demand else ""


def make(text: str, intensity: int = 3) -> dict:
    """给外部（比如卫生问题）构造一条记仇的入参。"""
    return {"text": text, "kind": GRUDGE, "intensity": intensity}
