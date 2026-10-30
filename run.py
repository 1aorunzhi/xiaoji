"""启动入口：python run.py"""

from __future__ import annotations

import uvicorn

from app import config

if __name__ == "__main__":
    print(f"\n  小记 · http://{config.HOST}:{config.PORT}\n")
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=False)
