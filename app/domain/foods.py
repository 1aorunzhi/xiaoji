"""吃的：食物表、口味、饱腹度。

口味是出生那一刻定死的：拿出生时间当种子算一次，之后写进存档不再变。
所以刷新页面、换设备导出导入，它爱吃的东西都不会改口。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .growth import clamp


@dataclass(frozen=True)
class Food:
    id: str
    name: str
    note: str
    exp: int
    mood: int
    full: int
    trait: dict = field(default_factory=dict)


FOODS: tuple[Food, ...] = (
    Food("snack", "小鱼干", "咸的，嚼起来带劲", 16, 4, 9, {"sharp": 1.4}),
    Food("stick", "猫条", "一挤就出来", 24, 7, 12, {"social": 1.4}),
    Food("can", "罐头", "开罐声隔着两道门都听得见", 38, 11, 32, {"social": 1}),
    Food("salmon", "三文鱼", "整条的，得抱着啃", 52, 15, 38, {"calm": 1.2}),
    Food("mystery", "不明物体", "你也忘了这是什么", 30, 0, 18, {}),
)

FOOD_BY_ID: dict[str, Food] = {f.id: f for f in FOODS}

# 能有偏爱的东西；不明物体没得挑
EDIBLE: tuple[str, ...] = ("snack", "stick", "can", "salmon")


def get(food_id: str) -> Food | None:
    return FOOD_BY_ID.get(food_id)


def roll_taste(seed: int) -> dict:
    """出生时定口味。

    注：JS 版这里是 32 位位移，会截断毫秒时间戳；Python 的整数没有截断，
    所以同一时间戳算出来的结果和旧版不同。但一只宠物只在出生时算一次并
    存进库，之后永远读存档，所以不影响「不换口味」这个性质。
    """
    n = abs(int(seed or 1)) >> 3
    love = EDIBLE[n % len(EDIBLE)]
    hate = EDIBLE[(n + 1 + ((n >> 2) % 3)) % len(EDIBLE)]
    if hate == love:
        hate = EDIBLE[(EDIBLE.index(love) + 2) % len(EDIBLE)]
    return {"love": love, "hate": hate}


def taste_of(pet, food_id: str) -> str:
    taste = pet.taste or roll_taste(pet.born)
    if taste.get("love") == food_id:
        return "love"
    if taste.get("hate") == food_id:
        return "hate"
    return "ok"


def taste_text(pet) -> str:
    taste = pet.taste or roll_taste(pet.born)
    love = get(taste.get("love", ""))
    hate = get(taste.get("hate", ""))
    if not love or not hate:
        return "还在摸索"
    return f"爱吃{love.name}，不碰{hate.name}"


def full_word(value: float) -> str:
    if value >= 96:
        return "撑得摊平了"
    if value >= 78:
        return "有点撑"
    if value >= 46:
        return "八分饱"
    if value >= 22:
        return "有点饿"
    return "饿得发慌"


def drain_full(pet, now: int) -> None:
    """肚子自己会空：一小时掉 14%，七个多小时回到底。"""
    if pet.full is None:
        pet.full = 56
    last = pet.full_at or pet.last_seen or now
    hours = (now - last) / 3_600_000
    pet.full_at = now
    if hours <= 0:
        return
    pet.full = clamp(pet.full - hours * 14, 0, 100)


def feed_food(pet, food_id: str, now: int) -> dict | None:
    """真的喂一口。返回这次吃成没吃成、长了多少、爱不爱吃。"""
    food = get(food_id)
    if food is None:
        return None

    drain_full(pet, now)
    taste = taste_of(pet, food.id)
    first_time = food.id not in pet.ate

    # 已经塞到嗓子眼了
    if pet.full >= 96:
        pet.mood = clamp(pet.mood - 2, 0, 100)
        return {
            "food": food,
            "refused": True,
            "taste": taste,
            "full": pet.full,
            "exp": 0,
            "first_time": first_time,
        }

    from .growth import level_of

    before_level = level_of(pet.exp)
    stuffed = pet.full >= 78

    exp = food.exp
    mood = food.mood
    weird = 0.0

    if food.id == "mystery":
        # 它自己也不知道这次是什么味道
        import random

        weird = random.random()
        exp = round(14 + weird * 48)
        mood = round(-9 + weird * 19)

    if taste == "love":
        exp = round(exp * 1.3)
        mood = round(mood * 1.5 + 2)
    elif taste == "hate":
        exp = round(exp * 0.7)
        mood -= 4

    if stuffed:
        exp = round(exp * 0.55)

    pet.feeds += 1
    pet.exp += exp
    pet.mood = clamp(pet.mood + mood, 0, 100)
    pet.full = clamp(pet.full + (food.full * 0.5 if stuffed else food.full), 0, 100)
    pet.last_seen = now
    pet.full_at = now
    # 吃进去的东西不会凭空消失，它总得还回来
    pet.gut = clamp((pet.gut or 0) + food.full * 0.75, 0, 220)
    pet.gut_at = now

    if first_time:
        pet.ate.append(food.id)

    # 吃的东西会慢慢驯化它
    for key, delta in (food.trait or {}).items():
        if isinstance(pet.traits.get(key), (int, float)):
            pet.traits[key] = clamp(pet.traits[key] + delta, 0, 100)

    return {
        "food": food,
        "exp": exp,
        "mood": mood,
        "taste": taste,
        "weird": weird,
        "first_time": first_time,
        "stuffed": stuffed,
        "refused": False,
        "level_up": level_of(pet.exp) > before_level,
        "level": level_of(pet.exp),
        "full": pet.full,
    }


# 它开的价里提到的东西，喂对了就算兑现
FOOD_WORDS: dict[str, tuple[str, ...]] = {
    "snack": ("小鱼干", "鱼干"),
    "stick": ("猫条",),
    "can": ("罐头",),
    "salmon": ("三文鱼",),
}


def pays_for(demand_text: str, food_id: str) -> bool:
    words = FOOD_WORDS.get(food_id, ())
    text = str(demand_text or "")
    return any(word in text for word in words)
