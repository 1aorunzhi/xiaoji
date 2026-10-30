"""模型调用：流式对话 + JSON 复盘。

底层是 OpenAI 兼容的 chat/completions，但认证走自定义请求头
（x-wb-webapp-access-key），不是标准的 Authorization: Bearer —— 这一点
如果不照着做，接口会一直回 invalid_client。
"""

from __future__ import annotations

import json
import re
from typing import AsyncIterator

import httpx

from . import config

NON_CHAT = re.compile(r"image|video|tts|asr|embed|rerank|kling|vision-only", re.I)

_model: str | None = None


class BrainError(Exception):
    """统一的大脑异常，message 直接可以给用户看。"""

    def __init__(self, code: str, user_message: str):
        super().__init__(code)
        self.code = code
        self.user_message = user_message


def friendly_error(err: Exception) -> str:
    """把各种上游错误翻译成用户能懂的一句话。"""
    if isinstance(err, BrainError):
        return err.user_message
    text = str(err)
    if "quota" in text:
        return "小记吃不下了（额度用尽），过一会儿再来。"
    if "invalid_client" in text or "401" in text or "403" in text:
        return "小记认不出这里，可能需要在正式域名下打开。"
    if "model" in text.lower():
        return "小记走神了，再喂一次试试。"
    return "小记突然不吭声了，再试一次。"


def _headers() -> dict:
    return {
        config.KEY_HEADER: config.ACCESS_KEY,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }


async def list_models() -> list[dict]:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{config.ENDPOINT}/.cloud/llm/models", headers=_headers())
        if resp.status_code >= 400:
            raise BrainError("models_failed", friendly_error(Exception(resp.text)))
        data = resp.json()
    if isinstance(data, dict):
        data = data.get("data") or data.get("models") or []
    return [m for m in data if isinstance(m, dict)]


async def ensure_model() -> str:
    """挑一个可用的对话模型，挑一次就记住。"""
    global _model
    if _model:
        return _model

    models = await list_models()
    usable = [
        m
        for m in models
        if m.get("disabled") is not True
        and m.get("enabled") is not False
        and not NON_CHAT.search(str(m.get("id", "")))
    ]
    if not usable:
        raise BrainError("no_model", "暂时没有可用的大脑。")

    by_id = {m.get("id"): m for m in usable}
    for preferred in config.PREFERRED_MODELS:
        if preferred in by_id:
            _model = preferred
            return _model
    fallback = next((m for m in usable if m.get("id") != "auto"), usable[0])
    _model = str(fallback.get("id"))
    return _model


def _payload(system: str, messages: list[dict], model: str, temperature: float) -> dict:
    return {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        "stream": True,
        "temperature": temperature,
    }


async def iter_chat(
    system: str,
    messages: list[dict],
    temperature: float = 1.0,
) -> AsyncIterator[str]:
    """逐字吐出模型的回复。这是唯一真正的流式入口。"""
    model = await ensure_model()

    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20)) as client:
        async with client.stream(
            "POST",
            f"{config.ENDPOINT}/.cloud/llm/chat/completions",
            headers=_headers(),
            json=_payload(system, messages, model, temperature),
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", "ignore")
                raise BrainError("chat_failed", friendly_error(Exception(body)))

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    data = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield delta


async def stream_chat(
    system: str,
    messages: list[dict],
    temperature: float = 1.0,
    on_delta=None,
) -> str:
    """收齐版：边收边回调，最后返回完整文本。"""
    parts: list[str] = []
    async for delta in iter_chat(system, messages, temperature):
        parts.append(delta)
        if on_delta:
            on_delta(delta)
    return "".join(parts)


async def json_chat(system: str, messages: list[dict], temperature: float = 0.3) -> dict | None:
    """一次性调用，把流式结果收齐后解析成 JSON。"""
    raw = await stream_chat(system, messages, temperature)
    return extract_json(raw)


def extract_json(text: str) -> dict | None:
    if not text:
        return None
    body = str(text).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", body, re.I)
    if fence:
        body = fence.group(1).strip()
    start = body.find("{")
    end = body.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        data = json.loads(body[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def is_ready() -> bool:
    try:
        await ensure_model()
        return True
    except Exception:
        return False
