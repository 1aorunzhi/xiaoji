"""FastAPI 入口。

页面本身还是原来那套（web/），但所有动脑子的活都在 Python 这边：
拼提示词、算等级、判记仇、调模型、存存档。

启动：
    python run.py
或
    uvicorn app.main:app --reload
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import service, store

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # 让反向代理别把流攒起来
    "X-Accel-Buffering": "no",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init_db()
    yield


app = FastAPI(title="小记", lifespan=lifespan)


def sse(events) -> StreamingResponse:
    """把 service 的事件流转成 SSE。"""

    async def stream():
        try:
            async for event in events:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as err:  # noqa: BLE001
            payload = {"type": "error", "text": f"后端出错了：{err}"}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


class TextBody(BaseModel):
    text: str = ""


class IdBody(BaseModel):
    id: str = ""


class NameBody(BaseModel):
    name: str = "小记"


class KindBody(BaseModel):
    kind: str = "return"
    # 前端从 /api/boot 拿到「离开了多久」，回来时再传一次。
    # boot 里已经结算过离线时间，到这时候 last_seen 早被刷新成现在了。
    away: float = 0.0


# ---------------------------------------------------------------- 页面


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")
app.mount("/src", StaticFiles(directory=WEB / "src"), name="src")


# ---------------------------------------------------------------- 状态


@app.get("/api/boot")
async def boot(stage: int = 0) -> dict:
    return await service.boot(stage)


@app.post("/api/intro")
async def intro(body: NameBody):
    return sse(service.intro(body.name))


@app.post("/api/reset")
async def reset():
    return sse(service.reset())


@app.post("/api/touch")
async def touch():
    return sse(service.touch())


@app.get("/api/poke")
async def poke() -> dict:
    return await service.random_poke()


# ---------------------------------------------------------------- 交互


@app.post("/api/feed")
async def feed(body: TextBody):
    text = body.text.strip()[:140]
    if not text:
        raise HTTPException(status_code=400, detail="空的那句不算喂")
    return sse(service.feed_text(text))


@app.post("/api/eat")
async def eat(body: IdBody):
    return sse(service.eat_food(body.id))


@app.post("/api/clean")
async def clean(body: IdBody):
    return sse(service.clean(body.id))


@app.post("/api/pay")
async def pay(body: IdBody):
    return sse(service.pay(body.id))


@app.post("/api/speak")
async def speak(body: KindBody):
    return sse(service.speak(body.kind, body.away))


@app.post("/api/tick")
async def tick():
    return sse(service.tick())


# ---------------------------------------------------------------- 存档码


@app.get("/api/code")
async def get_code() -> dict:
    pet = store.load()
    if pet is None:
        raise HTTPException(status_code=404, detail="还没有宠物")
    return {"code": store.encode(pet)}


@app.post("/api/code")
async def load_code(body: TextBody):
    pet = store.decode(body.text)
    if pet is None:
        raise HTTPException(status_code=400, detail="这个存档码读不出来")
    store.save(pet, pet.last_seen)
    return {"ok": True, "state": pet.to_state()}
