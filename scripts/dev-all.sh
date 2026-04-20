#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "[dev-all] 缺少 uv，请先安装 uv" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${PYTHON_PID:-}" ]] && kill -0 "$PYTHON_PID" >/dev/null 2>&1; then
    kill "$PYTHON_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev-all] 启动 Python 侧车..."
uv run --directory "$ROOT_DIR/python_service" --python 3.13 uvicorn app:app --reload --port 8001 &
PYTHON_PID=$!

echo "[dev-all] 启动 Nuxt 主服务..."
cd "$ROOT_DIR"
pnpm dev
