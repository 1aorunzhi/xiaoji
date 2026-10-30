"""云端配置。

这里的 key 是「可发布密钥」，设计上就允许出现在前端和公开仓库里，
只用于换取模型调用额度，不涉及账号权限。想换成自己的模型服务时，
改这个文件即可（见 README「换成别的模型」一节）。
"""

from __future__ import annotations

import os

ENDPOINT = os.getenv("XIAOJI_LLM_ENDPOINT", "https://xiaoji-pet.app.workbuddy.host")
ACCESS_KEY = os.getenv(
    "XIAOJI_LLM_KEY",
    "wbpk_h8WxfTu1YU4o579v9wr0U4_16EN0ecF4esWC4cRH1PPy3AATQbzKlab",
)

# 认证走自定义头，不是标准的 Authorization: Bearer
KEY_HEADER = "x-wb-webapp-access-key"

# 优先用首字快、中文口语自然的模型；都不可用时退回列表里第一个对话模型
PREFERRED_MODELS = ("deepseek-v4.1-flash", "deepseek-v4-flash", "glm-5.3-flash", "hy3")

DB_PATH = os.getenv("XIAOJI_DB", "data/xiaoji.db")
HOST = os.getenv("XIAOJI_HOST", "127.0.0.1")
PORT = int(os.getenv("XIAOJI_PORT", "8000"))
