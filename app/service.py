"""业务流程：把一次交互变成一串事件。

前端不再自己算任何东西，它只是把这里吐出的事件画出来：

    state  —— 宠物的完整状态（前端整体重渲染）
    delta  —— 流式回复的一个增量
    chip   —— 聊天区里那条小圆片（记仇 / 开价 / 赔清 / 吃掉）
    toast  —— 底部飘过去的一句话
    note   —— 系统分隔行（"—— Lv.3 少年体 ——"）
    done   —— 这一轮结束

所有函数都是 async generator，路由层直接转成 SSE。
"""

from __future__ import annotations

import random
from typing import AsyncIterator

from . import brain, llm, store
from .domain import foods, grudges, growth, hygiene, memory
from .domain.memory import active_grudges
from .domain.pet import Pet, now_ms


def state_event(pet: Pet, now: int) -> dict:
    return {"type": "state", "data": pet.to_state(now)}


def _auto_events(pet: Pet, now: int) -> list[dict]:
    """时间推进带来的变化：消化、拉屎、旧账淡忘。"""
    events: list[dict] = []
    made = hygiene.flush_poop(pet, now)
    if made:
        count = len(pet.poop)
        events.append(state_event(pet, now))
        events.append(
            {
                "type": "toast",
                "text": "地上已经堆满了，它没地方下脚"
                if count >= hygiene.POOP_MAX
                else "它拉了。点一下地上的东西就能收拾",
                "ms": 2800,
            }
        )
    grudge = hygiene.poop_sick(pet, now)
    if grudge:
        events.append({"type": "chip", "text": f"记仇 · {grudge.text}", "kind": "grudge"})
        events.append({"type": "toast", "text": "这件事它记下了", "ms": 2600})
    if memory.settle_grudges(pet):
        events.append({"type": "toast", "text": "它把一件旧账淡忘了", "ms": 2200})
    return events


# ---------------------------------------------------------------- 起名 / 重养


async def intro(name: str) -> AsyncIterator[dict]:
    """起个名字，然后让它睁眼说第一句。"""
    now = now_ms()
    pet = Pet.create(name or "小记", now)
    store.save(pet, now)
    yield {"type": "born", "data": pet.to_state(now)}
    async for event in _speak(pet, "birth"):
        yield event


async def reset() -> AsyncIterator[dict]:
    store.reset()
    yield {"type": "reset"}


# ---------------------------------------------------------------- 喂一句话


async def feed_text(text: str) -> AsyncIterator[dict]:
    now = now_ms()
    pet = store.load()
    if pet is None:
        yield {"type": "error", "text": "还没有宠物。"}
        return

    result = pet.feed_text(text, now)
    yield state_event(pet, now)

    if result["level_up"]:
        yield {"type": "jump"}
        yield {
            "type": "toast",
            "text": f"它长了一点 · Lv.{result['level']} {growth.stage_of(result['level'])}",
            "ms": 2200,
        }
        yield {
            "type": "note",
            "text": f"—— Lv.{result['level']} {growth.stage_of(result['level'])} · {result['weight']}g ——",
        }

    # 先看东西到手没有：到手就先记上，它开口时才知道该松口
    just_paid = None
    pending = grudges.pending_deal(pet)
    if pending and grudges.looks_paid(text):
        if grudges.pay_off(pending, now):
            just_paid = pending
            yield {"type": "chip", "text": f"赔清了 · {pending.text}", "kind": "paid"}

    # 道歉不顶用：它会当场开价，第二回还加价
    if just_paid is None and grudges.is_apology(text):
        # 一句里既认了错又招了事（"对不起，我昨天放了你鸽子"）：
        # 这笔账得先立起来，回复才有价可报。否则模型自己编一个价,
        # 小圆片上是另一套，前后对不上。
        if grudges.pending_deal(pet) is None:
            async for event in _prebook(pet, text, now):
                yield event
        deal = grudges.raise_demand(pet, now=now)
        if deal:
            cond = deal["grudge"].demand["text"]
            if deal["capped"]:
                line = f"它不松口 · 条件早摆着了：{cond}"
            elif deal["escalated"]:
                line = f"它加价了 · 现在要 {cond}"
            else:
                line = f"它开了个价 · {cond}，不然不翻篇"
            yield {"type": "chip", "text": line, "kind": "demand"}
            yield {
                "type": "toast",
                "text": "道歉了两次，价钱翻了一档" if deal["escalated"] else "它不接受道歉，只接受补偿",
                "ms": 2400,
            }

    async for event in _reply(pet, just_paid, now):
        yield event

    # 复盘：让模型把这轮写进它的脑子
    async for event in _reflect(pet, text, pet.last_assistant_text(), now):
        yield event

    store.save(pet, now_ms())
    yield {"type": "done"}


async def _prebook(pet: Pet, text: str, now: int) -> AsyncIterator[dict]:
    """道歉那一轮先把新账立起来。

    只借抽取器的一半能力：拿到这一轮新认的「记仇」就停，性格和心情留给
    后面的复盘统一算。失败就算了，回复照旧走，顶多价钱对不上。
    """
    try:
        data = await llm.json_chat(
            brain.build_extract_prompt(),
            [{"role": "user", "content": brain.build_extract_input(text, "", pet)}],
            temperature=0.2,
        )
    except Exception:  # noqa: BLE001
        return
    if not data:
        return

    for item in (data.get("memories") or [])[:2]:
        if not isinstance(item, dict) or item.get("kind") != memory.GRUDGE:
            continue
        added = pet.add_memory(
            item.get("text", ""), memory.GRUDGE, int(item.get("intensity") or 3), now
        )
        if added:
            yield {"type": "chip", "text": f"记仇 · {added.text}", "kind": memory.GRUDGE}
            return


def _deal_reminder(pet: Pet) -> list[dict]:
    """把当前开的价钉在 messages 的最后一条。

    system prompt 里已经写了三遍，但历史对话里如果出现过旧报价，模型会
    顺着旧的往下说（它更相信离自己最近的那句话）。所以这里再用一条紧贴
    输出的提醒压住——这一条不显示给用户，只给模型看。
    """
    deal = grudges.pending_deal(pet)
    if not deal or not deal.demand:
        return []
    return [
        {
            "role": "user",
            "content": (
                f"（提醒：你现在开的价是「{deal.demand['text']}」。"
                "这一句只能说这个，之前对话里报过的其他价钱全部作废，不许再提。）"
            ),
        }
    ]


async def _reply(pet: Pet, just_paid, now: int) -> AsyncIterator[dict]:
    """主回复：流式吐出，最后把收口后的文本落进历史。"""
    system = brain.build_system_prompt(pet, now, {"just_paid": just_paid})
    messages = pet.messages(10) + _deal_reminder(pet)

    yield {"type": "thinking", "on": True}
    buffer: list[str] = []
    try:
        async for delta in _stream(system, messages, 1.05):
            buffer.append(delta)
            yield {"type": "delta", "text": delta}
        raw = "".join(buffer)
        if not raw.strip():
            raise llm.BrainError("empty", "empty")
        clean = brain.polish_reply(raw, pet.last_assistant_text())
        pet.push_reply(clean, now=now)
        yield {"type": "finish", "text": clean}
    except Exception as err:  # noqa: BLE001
        fallback = brain.offline_reply(pet, "feed")
        pet.push_reply(fallback, now=now)
        yield {"type": "finish", "text": fallback}
        yield {"type": "toast", "text": llm.friendly_error(err), "ms": 3200}
    finally:
        yield {"type": "thinking", "on": False}


async def _stream(system: str, messages: list[dict], temperature: float):
    """逐字转发模型输出。这里必须是真的流式，否则前端看不到打字效果。"""
    async for delta in llm.iter_chat(system, messages, temperature):
        yield delta


async def _reflect(pet: Pet, user_text: str, reply_text: str, now: int) -> AsyncIterator[dict]:
    """复盘：记忆 + 性格漂移 + 心情 + 兑现判定。"""
    if not user_text or not reply_text:
        return

    yield {"type": "chip", "text": "正在把这句话写进脑子里…", "kind": "working", "id": "reflect"}

    data = None
    try:
        data = await llm.json_chat(
            brain.build_extract_prompt(),
            [{"role": "user", "content": brain.build_extract_input(user_text, reply_text, pet)}],
            temperature=0.3,
        )
    except Exception:  # noqa: BLE001
        data = None

    yield {"type": "drop", "id": "reflect"}
    if not data:
        return

    traits = data.get("traits") or {}
    for key in ("sharp", "calm", "social"):
        delta = _num(traits.get(key))
        pet.traits[key] = growth.clamp(
            pet.traits[key] + growth.clamp(delta, -6, 6) * 1.7, 0, 100
        )

    if isinstance(data.get("mood"), (int, float)):
        pet.mood = growth.clamp(pet.mood + growth.clamp(data["mood"], -12, 12) * 0.7, 0, 100)

    shown = 0
    for item in (data.get("memories") or [])[:2]:
        if not isinstance(item, dict):
            continue
        added = pet.add_memory(
            item.get("text", ""),
            item.get("kind", memory.FACT),
            int(item.get("intensity") or 3),
            now,
        )
        if added:
            label = (
                f"记仇 · {added.text}"
                if added.kind == memory.GRUDGE
                else f"承诺 · {added.text}"
                if added.kind == memory.PROMISE
                else added.text
            )
            yield {"type": "chip", "text": label, "kind": added.kind}
            shown += 1
    if shown:
        yield {"type": "jump"}

    # 条件真兑现了才翻篇
    paid = 0
    for snippet in (data.get("pay") or [])[:2]:
        target = memory.match_grudge(pet, snippet)
        if target and grudges.pay_off(target, now):
            yield {"type": "chip", "text": f"赔清了 · {target.text}", "kind": "paid"}
            paid += 1
    if paid:
        yield {"type": "toast", "text": "……这还差不多。", "ms": 2200}

    # 同一轮里既认了错又新开了一笔账：这个价也得当场摆出来
    if not paid and grudges.is_apology(user_text):
        fresh = next(
            (g for g in active_grudges(pet) if not g.demand and g.feed_at == pet.feeds),
            None,
        )
        if fresh:
            deal = grudges.raise_demand(pet, fresh, now)
            if deal:
                yield {
                    "type": "chip",
                    "text": f"它开了个价 · {deal['grudge'].demand['text']}，不然不翻篇",
                    "kind": "demand",
                }

    if memory.settle_grudges(pet):
        yield {"type": "toast", "text": "它把一件旧账淡忘了", "ms": 2200}

    yield state_event(pet, now)


def _num(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0


# ---------------------------------------------------------------- 喂真的吃的


async def eat_food(food_id: str) -> AsyncIterator[dict]:
    now = now_ms()
    pet = store.load()
    food = foods.get(food_id)
    if pet is None or food is None:
        yield {"type": "error", "text": "喂不了这个。"}
        return

    # 撑得塞不进去
    result = foods.feed_food(pet, food_id, now)
    if result is None:
        yield {"type": "error", "text": "喂不了这个。"}
        return

    if result["refused"]:
        yield {"type": "refuse_shake"}
        yield state_event(pet, now)
        yield {
            "type": "chip",
            "text": f"{food.name}被推回来了 · 它吃不下了",
            "kind": "fact",
        }
        yield {"type": "toast", "text": f"它{foods.full_word(pet.full)}，塞不进去", "ms": 2400}
        store.save(pet, now)
        yield {"type": "done"}
        return

    yield {"type": "chew"}
    yield state_event(pet, now)
    yield {"type": "chip", "text": f"吃掉{food.name} · +{result['exp']} 经验", "kind": "food"}
    if result["taste"] == "love":
        yield {"type": "jump"}

    if result["first_time"] and result["taste"] == "love":
        yield {"type": "toast", "text": "它吃得很快。原来它爱吃这个", "ms": 2200}
    elif result["first_time"] and result["taste"] == "hate":
        yield {"type": "toast", "text": "它嚼得很慢。好像不太行", "ms": 2200}
    elif result["stuffed"]:
        yield {"type": "toast", "text": "它有点撑了，硬塞的", "ms": 1800}

    # 喂的东西正好是它开的价：这笔账当场划掉
    just_paid = None
    pending = grudges.pending_deal(pet)
    if pending and pending.demand and foods.pays_for(pending.demand["text"], food_id):
        if grudges.pay_off(pending, now):
            just_paid = pending
            yield {"type": "chip", "text": f"赔清了 · {pending.demand['text']}", "kind": "paid"}
            yield {"type": "toast", "text": "东西到手了，这笔账划掉", "ms": 2400}

    if result["level_up"]:
        stage = growth.stage_of(result["level"])
        yield {"type": "toast", "text": f"它长了一点 · Lv.{result['level']} {stage}", "ms": 2200}
        yield {"type": "note", "text": f"—— Lv.{result['level']} {stage} · {pet.weight}g ——"}

    if result["first_time"]:
        pet.add_memory(f"主人第一次喂我吃{food.name}", memory.FACT, 3, now)

    store.save(pet, now)

    # 吃完这一口，让它自己说一句
    async for event in _food_talk(pet, food, result, just_paid, now):
        yield event

    store.save(pet, now_ms())
    yield {"type": "done"}


async def _food_talk(pet: Pet, food, result: dict, just_paid, now: int) -> AsyncIterator[dict]:
    taste_line = (
        "这是它最爱吃的，吃得很快"
        if result["taste"] == "love"
        else "它其实不太爱吃这个，嚼得很勉强"
        if result["taste"] == "hate"
        else "味道一般"
    )
    note = (
        f"（主人递给你{food.name}，你已经咽下去了。{taste_line}。"
        f"{'肚子里有点撑。' if result['stuffed'] else ''}）"
    )
    # 藏起来的这一条只给模型看，不进聊天记录
    pet.push_hidden_user(note, now)

    system = brain.build_system_prompt(
        pet,
        now,
        {
            "away_hours": 0,
            "just_paid": just_paid,
            "just_ate": {
                "name": food.name,
                "taste": result["taste"],
                "stuffed": result["stuffed"],
            },
        },
    )

    yield {"type": "thinking", "on": True}
    buffer: list[str] = []
    try:
        async for delta in _stream(system, pet.messages(10), 1.15):
            buffer.append(delta)
            yield {"type": "delta", "text": delta}
        raw = "".join(buffer)
        if not raw.strip():
            raise llm.BrainError("empty", "empty")
        clean = brain.polish_reply(raw, pet.last_assistant_text())
        pet.push_reply(clean, now=now)
        yield {"type": "finish", "text": clean}
    except Exception as err:  # noqa: BLE001
        fallback = brain.offline_reply(pet, "food", result["taste"])
        pet.push_reply(fallback, now=now)
        yield {"type": "finish", "text": fallback}
        yield {"type": "toast", "text": llm.friendly_error(err), "ms": 3000}
    finally:
        yield {"type": "thinking", "on": False}


# ---------------------------------------------------------------- 地上


async def clean(poop_id: str) -> AsyncIterator[dict]:
    now = now_ms()
    pet = store.load()
    if pet is None:
        yield {"type": "error", "text": "还没有宠物。"}
        return

    result = hygiene.clean_poop(pet, poop_id, now)
    if result is None:
        yield {"type": "state", "data": pet.to_state(now)}
        return

    yield {"type": "sweep", "id": poop_id}
    yield state_event(pet, now)
    yield {
        "type": "chip",
        "text": (
            f"收拾掉一坨 · 地上还剩 {result['left']}"
            if result["left"]
            else f"收拾干净了 · +{result['exp']} 经验"
        ),
        "kind": "fact",
    }

    # 还剩就不啰嗦，全弄干净它才肯开口
    if result["left"] == 0:
        async for event in _poop_talk(pet, result, now):
            yield event

    store.save(pet, now_ms())
    yield {"type": "done"}


async def _poop_talk(pet: Pet, result: dict, now: int) -> AsyncIterator[dict]:
    minutes = max(1, round(result["hours"] * 60))
    note = (
        f"（主人把地上你拉的那坨收掉了。"
        f"{'动作很快，没让它在那儿放多久' if result['quick'] else f'那坨在原地待了 {minutes} 分钟才被收走'}"
        "。地上现在干净了。）"
    )
    pet.push_hidden_user(note, now)

    system = brain.build_system_prompt(
        pet, now, {"away_hours": 0, "just_cleaned": {"quick": result["quick"], "mins": minutes}}
    )

    yield {"type": "thinking", "on": True}
    buffer: list[str] = []
    try:
        async for delta in _stream(system, pet.messages(10), 1.15):
            buffer.append(delta)
            yield {"type": "delta", "text": delta}
        raw = "".join(buffer)
        if not raw.strip():
            raise llm.BrainError("empty", "empty")
        clean_text = brain.polish_reply(raw, pet.last_assistant_text())
        pet.push_reply(clean_text, now=now)
        yield {"type": "finish", "text": clean_text}
    except Exception:  # noqa: BLE001
        fallback = "……手脚还挺快。" if result["quick"] else "总算想起来了。"
        pet.push_reply(fallback, now=now)
        yield {"type": "finish", "text": fallback}
    finally:
        yield {"type": "thinking", "on": False}


# ---------------------------------------------------------------- 让它开口


async def speak(kind: str, away: float = 0.0) -> AsyncIterator[dict]:
    pet = store.load()
    if pet is None:
        yield {"type": "error", "text": "还没有宠物。"}
        return
    async for event in _speak(pet, kind, away):
        yield event
    store.save(pet, now_ms())
    yield {"type": "done"}


async def _speak(pet: Pet, kind: str, away: float = 0.0) -> AsyncIterator[dict]:
    now = now_ms()
    info = pet.apply_offline(now)
    # boot 已经结算过一次，last_seen 被刷成了「现在」，这里算出来是 0。
    # 所以前端把它那会儿拿到的 awayHours 带过来，不然「久别重逢」这句
    # 它就不知道自己被晾了多久，只会顺着别的账往下说。
    hours = max(info["away_hours"], away)
    messages = [
        *pet.messages(8),
        {"role": "user", "content": brain.directive(kind, pet)},
    ]
    system = brain.build_system_prompt(pet, now, {"away_hours": hours})

    yield {"type": "thinking", "on": True}
    buffer: list[str] = []
    try:
        async for delta in _stream(system, messages, 1.1):
            buffer.append(delta)
            yield {"type": "delta", "text": delta}
        raw = "".join(buffer)
        if not raw.strip():
            raise llm.BrainError("empty", "empty")
        clean = brain.polish_reply(raw, pet.last_assistant_text())
        pet.push_reply(clean, now=now)
        yield {"type": "finish", "text": clean}
    except Exception:  # noqa: BLE001
        fallback = brain.offline_reply(pet, kind)
        pet.push_reply(fallback, now=now)
        yield {"type": "finish", "text": fallback}
    finally:
        yield {"type": "thinking", "on": False}
        yield state_event(pet, now)


# ---------------------------------------------------------------- 点「给了」


async def pay(memory_id: str) -> AsyncIterator[dict]:
    now = now_ms()
    pet = store.load()
    if pet is None:
        yield {"type": "error", "text": "还没有宠物。"}
        return

    target = next((m for m in pet.memories if m.id == memory_id), None)
    if target is None or not grudges.pay_off(target, now):
        yield {"type": "done"}
        return

    line = "（收下了）……行吧，这次算你过了。"
    pet.push_reply(line, now=now)
    store.save(pet, now)

    yield {"type": "message", "role": "pet", "text": line}
    yield {"type": "chip", "text": f"赔清了 · {target.text}", "kind": "paid"}
    yield {"type": "toast", "text": "它把东西收下了，这笔账划掉", "ms": 2400}
    yield state_event(pet, now)
    yield {"type": "done"}


# ---------------------------------------------------------------- 定时推进


async def tick() -> AsyncIterator[dict]:
    """前端每 45 秒叫一次：消化、拉屎、旧账淡忘。"""
    now = now_ms()
    pet = store.load()
    if pet is None:
        yield {"type": "done"}
        return

    events = _auto_events(pet, now)
    if events:
        store.save(pet, now)
    for event in events:
        yield event
    yield {"type": "done"}


async def boot(stage: int = 0) -> dict:
    """打开页面时的一次性状态。

    stage 是演示参数：直接把等级摆到指定档位，只看不存。
    演示和截图时不用先喂二十轮，也不会污染真实存档。
    """
    now = now_ms()
    pet = store.load()
    if pet is None:
        return {"exists": False}

    info = pet.apply_offline(now)
    hygiene.flush_poop(pet, now)
    # 离开这段时间地上堆着没人收拾：一进门就该算这笔账
    grudge = hygiene.poop_sick(pet, now)
    memory.settle_grudges(pet)
    store.save(pet, now)

    if stage:
        pet.exp = (min(16, max(1, stage)) - 1) * growth.EXP_PER_LEVEL
        pet.feeds = max(pet.feeds, stage * 6)
        # 档位只推等级不够：称号是性格算出来的，不推性格的话 Lv.10 还挂着
        # "还没长出性格的小东西"，截图和演示都对不上。
        if stage >= 3:
            pet.traits = {
                "sharp": min(88, 58 + stage * 3),
                "calm": max(30, 44 - stage),
                "social": min(90, 40 + stage * 5),
            }
        return {
            "exists": True,
            "state": pet.to_state(now),
            "awayHours": 0,
            "history": [m for m in pet.history[-8:] if not m.get("hidden")],
            "isNew": False,
            "chips": [],
            "demo": True,
            "aiReady": True,
        }

    return {
        "exists": True,
        "state": pet.to_state(now),
        "awayHours": info["away_hours"],
        "history": [m for m in pet.history[-8:] if not m.get("hidden")],
        "isNew": pet.feeds == 0,
        "chips": [{"text": f"记仇 · {grudge.text}", "kind": "grudge"}] if grudge else [],
        "aiReady": await llm.is_ready(),
    }


async def touch() -> AsyncIterator[dict]:
    """页面隐藏时记一下时间。"""
    now = now_ms()
    pet = store.load()
    if pet is not None:
        pet.last_seen = now
        store.save(pet, now)
    yield {"type": "done"}


async def random_poke() -> dict:
    """摸摸它（点宠物图形）。"""
    return {"text": random.choice(["唔？", "……干嘛。", "摸头是要收费的。", "嗯。", "别戳。"])}
