from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
from pathlib import Path
from time import perf_counter
from typing import Literal, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from dotenv import load_dotenv


DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
THINKING_BUDGET = 4096


class GenerateRequest(BaseModel):
    model: str
    prompt: str
    input_mode: Literal["url", "file"]
    video_url: Optional[str] = None
    video_path: Optional[str] = None
    enable_thinking: bool = False
    fps: float = Field(default=1.0, ge=0.1, le=10)
    aliyun_api_key: Optional[str] = None
    aliyun_base_url: Optional[str] = None


app = FastAPI(title="Comment Lab DashScope Sidecar")
logging.basicConfig(
    level=os.getenv("COMMENT_LAB_PYTHON_LOG_LEVEL", "INFO").upper(),
    format="[python-sidecar] %(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("comment_lab_sidecar")


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=False)
load_dotenv(_PROJECT_ROOT / ".env.local", override=False)


def get_api_key(override: Optional[str] = None) -> str:
    if override and override.strip():
        return override.strip()
    return (
        os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("ALIYUN_API_KEY")
        or os.getenv("ALIYUN_DASHSCOPE_API_KEY")
        or ""
    ).strip()


def normalize_base_url(override: Optional[str] = None) -> str:
    base_url = (
        override
        or
        os.getenv("DASHSCOPE_HTTP_BASE_URL")
        or os.getenv("ALIYUN_BASE_URL")
        or DEFAULT_BASE_URL
    ).strip()
    return base_url.rstrip("/").replace("/compatible-mode/v1", "/api/v1")


def _url_origin(value: str) -> str:
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return value
    return f"{parsed.scheme}://{parsed.netloc}"


def ensure_file_uri(video_path: str) -> str:
    if video_path.startswith("file://"):
        return video_path
    absolute = os.path.abspath(video_path)
    return f"file://{absolute}"


def supports_thinking_toggle(model: str) -> bool:
    return model.startswith("qwen3.5-plus") or model.startswith("qwen3.6-plus")


def resolve_enable_thinking(model: str, requested: bool) -> bool | None:
    if not supports_thinking_toggle(model):
        return None
    return bool(requested)


def build_thinking_kwargs(model: str, requested: bool) -> dict[str, object]:
    enable_thinking = resolve_enable_thinking(model, requested)
    if enable_thinking is None:
        return {}

    kwargs: dict[str, object] = {"enable_thinking": enable_thinking}
    if enable_thinking:
        kwargs["thinking_budget"] = THINKING_BUDGET
    return kwargs


def describe_video_source(request: GenerateRequest, source: str) -> dict[str, object]:
    if request.input_mode == "url":
        parsed = urlparse(source)
        return {
            "input_mode": "url",
            "video_host": parsed.netloc or None,
            "video_scheme": parsed.scheme or None,
            "video_url_length": len(source),
        }

    raw_path = source.removeprefix("file://")
    exists = os.path.exists(raw_path)
    size = None
    readable = False
    first16_hex = None
    if exists:
        try:
            size = os.path.getsize(raw_path)
            with open(raw_path, "rb") as video_file:
                first16_hex = video_file.read(16).hex()
                readable = True
        except OSError:
            size = None
    return {
        "input_mode": "file",
        "video_path_basename": os.path.basename(raw_path),
        "video_path_suffix": Path(raw_path).suffix or None,
        "video_exists": exists,
        "video_bytes": size,
        "video_readable": readable,
        "video_mime_guess": mimetypes.guess_type(raw_path)[0],
        "video_first16_hex": first16_hex,
    }


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


def _stringify_response_field(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _response_status_code(result: object) -> int | None:
    value = _get_attr(result, "status_code")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def describe_dashscope_failure(result: object) -> str:
    status_code = _response_status_code(result)
    code = _stringify_response_field(_get_attr(result, "code"))
    message = _stringify_response_field(_get_attr(result, "message"))
    request_id = _stringify_response_field(_get_attr(result, "request_id"))

    parts: list[str] = []
    if status_code is not None:
        parts.append(f"HTTP {status_code}")
    if code:
        parts.append(code)
    if message:
        parts.append(message)
    if request_id:
        parts.append(f"request_id={request_id}")

    return " | ".join(parts) or "DashScope 调用失败"


def ensure_dashscope_success(result: object) -> None:
    status_code = _response_status_code(result)
    code = _stringify_response_field(_get_attr(result, "code"))

    if (status_code is not None and status_code != 200) or code:
        raise HTTPException(status_code=502, detail=describe_dashscope_failure(result))


async def run_conversation(request: GenerateRequest, request_id: str) -> dict[str, object]:
    started_at = perf_counter()
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

    api_key = get_api_key(request.aliyun_api_key)
    if not api_key:
        logger.error("request api-key-missing request_id=%s model=%s", request_id, request.model)
        raise HTTPException(status_code=500, detail="DashScope API Key 未配置")

    try:
        import dashscope
        from dashscope import MultiModalConversation
    except ModuleNotFoundError as exc:  # pragma: no cover - surfaced in runtime env
        raise HTTPException(status_code=500, detail="DashScope SDK 未安装") from exc

    dashscope.base_http_api_url = normalize_base_url(request.aliyun_base_url)
    call_kwargs = build_thinking_kwargs(request.model, request.enable_thinking)
    logger.info(
        "request start request_id=%s model=%s fps=%s prompt_chars=%s api_key_present=%s base_origin=%s thinking_requested=%s thinking_kwargs=%s source=%s",
        request_id,
        request.model,
        request.fps,
        len(request.prompt),
        bool(api_key),
        _url_origin(dashscope.base_http_api_url),
        request.enable_thinking,
        call_kwargs,
        describe_video_source(request, source),
    )

    def _call():
        return MultiModalConversation.call(
            api_key=api_key,
            model=request.model,
            messages=messages,
            **call_kwargs,
        )

    result = await asyncio.to_thread(_call)
    elapsed_ms = int((perf_counter() - started_at) * 1000)
    logger.info(
        "dashscope response request_id=%s status_code=%s code=%s dashscope_request_id=%s elapsed_ms=%s detail=%s",
        request_id,
        _response_status_code(result),
        _stringify_response_field(_get_attr(result, "code")) or None,
        _stringify_response_field(_get_attr(result, "request_id")) or None,
        elapsed_ms,
        describe_dashscope_failure(result),
    )
    ensure_dashscope_success(result)
    raw_text = extract_text(result)
    if not raw_text:
        logger.error(
            "dashscope empty-text request_id=%s status_code=%s dashscope_request_id=%s elapsed_ms=%s output_type=%s",
            request_id,
            _response_status_code(result),
            _stringify_response_field(_get_attr(result, "request_id")) or None,
            elapsed_ms,
            type(_get_attr(result, "output")).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=f"DashScope 响应为空或不包含文本内容: {describe_dashscope_failure(result)}",
        )
    logger.info(
        "request success request_id=%s model=%s raw_text_chars=%s elapsed_ms=%s",
        request_id,
        request.model,
        len(raw_text),
        elapsed_ms,
    )

    return {
        "ok": True,
        "rawText": raw_text,
        "model": request.model,
    }


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/generate")
async def generate(request: GenerateRequest, http_request: Request):
    request_id = http_request.headers.get("x-request-id", "") or "unknown"
    try:
        return await run_conversation(request, request_id)
    except HTTPException as exc:
        logger.error(
            "request failed request_id=%s status_code=%s detail=%s",
            request_id,
            exc.status_code,
            exc.detail,
        )
        raise
    except Exception as exc:  # pragma: no cover - surfaced to Node
        logger.exception("request crashed request_id=%s", request_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("COMMENT_LAB_SIDECAR_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
