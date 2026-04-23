#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "[prod-all] 缺少 uv，请先安装 uv" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${PYTHON_PID:-}" ]] && kill -0 "$PYTHON_PID" >/dev/null 2>&1; then
    kill "$PYTHON_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[prod-all] 构建 Nuxt 生产包..."
cd "$ROOT_DIR"
npm run build

echo "[prod-all] 启动 Python 侧车..."
uv run --directory "$ROOT_DIR/python_service" --python 3.13 uvicorn app:app --port 8001 &
PYTHON_PID=$!

echo "[prod-all] 启动 Nuxt 生产预览..."
exec npm run preview -- --host 0.0.0.0 --port "${APP_PORT:-3000}"
