from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from dotenv import load_dotenv


DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"


class GenerateRequest(BaseModel):
    model: str
    prompt: str
    input_mode: Literal["url", "file"]
    video_url: Optional[str] = None
    video_path: Optional[str] = None
    fps: float = Field(default=1.0, ge=0.1, le=10)


app = FastAPI(title="Comment Lab DashScope Sidecar")


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=False)
load_dotenv(_PROJECT_ROOT / ".env.local", override=False)


def get_api_key() -> str:
    return (
        os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("ALIYUN_API_KEY")
        or os.getenv("ALIYUN_DASHSCOPE_API_KEY")
        or ""
    ).strip()


def normalize_base_url() -> str:
    base_url = (
        os.getenv("DASHSCOPE_HTTP_BASE_URL")
        or os.getenv("ALIYUN_BASE_URL")
        or DEFAULT_BASE_URL
    ).strip()
    return base_url.rstrip("/").replace("/compatible-mode/v1", "/api/v1")


def ensure_file_uri(video_path: str) -> str:
    if video_path.startswith("file://"):
        return video_path
    absolute = os.path.abspath(video_path)
    return f"file://{absolute}"


def should_disable_thinking(model: str) -> bool:
    return model.startswith("qwen3.5-plus") or model.startswith("qwen3.6-plus")


def _as_mapping(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def _get_attr(value: object, key: str) -> object | None:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _walk_text_nodes(node: object) -> list[str]:
    if node is None:
        return []

    if isinstance(node, str):
        text = node.strip()
        return [text] if text else []

    if isinstance(node, (list, tuple)):
        parts: list[str] = []
        for item in node:
            parts.extend(_walk_text_nodes(item))
        return parts

    if isinstance(node, dict) or hasattr(node, "__dict__"):
        parts: list[str] = []

        for key in ("text", "content", "delta", "message", "output", "choices"):
            child = _get_attr(node, key)
            if child is None:
                continue

            if key == "text" and isinstance(child, str):
                text = child.strip()
                if text:
                    return [text]
                continue

            if key == "content":
                if isinstance(child, str):
                    text = child.strip()
                    if text:
                        return [text]
                    continue
                if isinstance(child, (list, tuple)):
                    parts.extend(_walk_text_nodes(child))
                    continue
                if child is not None:
                    parts.extend(_walk_text_nodes(child))
                    continue

            parts.extend(_walk_text_nodes(child))

        return parts

    return []


def extract_text(result: object) -> str:
    texts = _walk_text_nodes(result)
    if texts:
        return "\n".join(texts).strip()
    return ""


async def run_conversation(request: GenerateRequest) -> dict[str, object]:
    source: Optional[str]
    if request.input_mode == "url":
        source = (request.video_url or "").strip()
        if not source:
            raise HTTPException(status_code=400, detail="video_url 不能为空")
    else:
        source = (request.video_path or "").strip()
        if not source:
            raise HTTPException(status_code=400, detail="video_path 不能为空")
        source = ensure_file_uri(source)
        raw_path = source.removeprefix("file://")
        if not os.path.exists(raw_path):
            raise HTTPException(status_code=400, detail=f"本地视频不存在: {raw_path}")

    messages = [
        {
            "role": "user",
            "content": [
                {"video": source, "fps": request.fps},
                {"text": request.prompt},
            ],
        }
    ]

    api_key = get_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="DashScope API Key 未配置")

    try:
        import dashscope
        from dashscope import MultiModalConversation
    except ModuleNotFoundError as exc:  # pragma: no cover - surfaced in runtime env
        raise HTTPException(status_code=500, detail="DashScope SDK 未安装") from exc

    dashscope.base_http_api_url = normalize_base_url()

    def _call():
        call_kwargs = {}
        if should_disable_thinking(request.model):
            call_kwargs["enable_thinking"] = False

        return MultiModalConversation.call(
            api_key=api_key,
            model=request.model,
            messages=messages,
            **call_kwargs,
        )

    result = await asyncio.to_thread(_call)
    raw_text = extract_text(result)

    return {
        "ok": True,
        "rawText": raw_text,
        "model": request.model,
    }


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/generate")
async def generate(request: GenerateRequest):
    try:
        return await run_conversation(request)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - surfaced to Node
        raise HTTPException(status_code=502, detail=str(exc)) from exc
