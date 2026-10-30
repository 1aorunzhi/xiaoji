"""成长、等级、称号 —— 纯函数，不碰存储也不碰网络。

这一层对应原来 JS 版 state.js 的「成长」部分。所有函数都是无副作用的
计算，方便单独测试。
"""

from __future__ import annotations

import math

MAX_LEVEL = 16
EXP_PER_LEVEL = 72


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def level_of(exp: float) -> int:
    """每 72 点经验升一级，16 级封顶。"""
    return min(MAX_LEVEL, 1 + int(exp // EXP_PER_LEVEL))


def weight_of(exp: float) -> int:
    return round(20 + exp * 0.85)


def stage_of(level: int) -> str:
    if level <= 2:
        return "幼体"
    if level <= 4:
        return "幼崽"
    if level <= 7:
        return "少年体"
    if level <= 10:
        return "成熟体"
    if level <= 13:
        return "完全体"
    return "某种东西"


def exp_to_next(exp: float) -> int:
    level = level_of(exp)
    if level >= MAX_LEVEL:
        return 0
    return max(0, math.ceil(level * EXP_PER_LEVEL - exp))


def exp_progress(exp: float) -> float:
    level = level_of(exp)
    if level >= MAX_LEVEL:
        return 100.0
    base = (level - 1) * EXP_PER_LEVEL
    return max(3.0, min(100.0, ((exp - base) / EXP_PER_LEVEL) * 100))


def mood_word(mood: float) -> str:
    if mood >= 84:
        return "兴奋得发抖"
    if mood >= 66:
        return "还不错"
    if mood >= 46:
        return "有点闷"
    if mood >= 26:
        return "不太高兴"
    if mood >= 12:
        return "在生气"
    return "冷战中"


def mood_label_short(mood: float) -> str:
    if mood >= 84:
        return "亢奋"
    if mood >= 66:
        return "还行"
    if mood >= 46:
        return "闷闷的"
    if mood >= 26:
        return "不高兴"
    return "记仇中"


def title_of(traits: dict) -> str:
    """性格三轴 → 一个称号。这是它这段时间被养出来的结果。"""
    sharp = traits.get("sharp", 58)
    calm = traits.get("calm", 44)
    social = traits.get("social", 40)

    if sharp >= 72 and calm >= 72:
        return "清醒的老阴阳人"
    if sharp <= 30 and social >= 72:
        return "黏人的小傻白甜"
    if calm <= 28 and social <= 30:
        return "躲起来发疯的小东西"
    if social >= 76 and sharp >= 66:
        return "嘴上不饶人的社交恐怖分子"

    a = "嘴毒的" if sharp >= 64 else "软糯的" if sharp <= 36 else ""
    b = "话痨" if social >= 64 else "独居" if social <= 36 else ""
    c = "小哲学家" if calm >= 64 else "小疯子" if calm <= 36 else "小东西"
    title = f"{a}{b}{c}"
    return "还没长出性格的小东西" if title == "小东西" else title


def trait_hint(traits: dict) -> str:
    sharp = traits.get("sharp", 58)
    calm = traits.get("calm", 44)
    social = traits.get("social", 40)
    parts: list[str] = []
    if sharp >= 60:
        parts.append("说话带刺")
    elif sharp <= 40:
        parts.append("说话软软的")
    if calm >= 60:
        parts.append("爱讲道理")
    elif calm <= 40:
        parts.append("很跳脱")
    if social >= 60:
        parts.append("特别黏人")
    elif social <= 40:
        parts.append("不太理人")
    return "，".join(parts) + "。" if parts else "还在长，说不好。"
