from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import dashscope
from dashscope import MultiModalConversation
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


def extract_text(result: object) -> str:
    output = getattr(result, "output", None)
    if output is None and isinstance(result, dict):
        output = result.get("output")

    if output is None:
        return ""

    text = getattr(output, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    choices = getattr(output, "choices", None)
    if choices is None and isinstance(output, dict):
        choices = output.get("choices")

    if isinstance(choices, list) and choices:
        message = getattr(choices[0], "message", None)
        if message is None and isinstance(choices[0], dict):
            message = choices[0].get("message")

        content = getattr(message, "content", None)
        if content is None and isinstance(message, dict):
            content = message.get("content")

        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                part_text = item.get("text") if isinstance(item, dict) else getattr(item, "text", None)
                if isinstance(part_text, str) and part_text:
                    parts.append(part_text)
            return "".join(parts).strip()

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

    dashscope.base_http_api_url = normalize_base_url()

    def _call():
        return MultiModalConversation.call(
            api_key=api_key,
            model=request.model,
            messages=messages,
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
