#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_DIR="$ROOT_DIR/python_service"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"
BASE_NAME="comment-lab-python-sidecar"

if ! command -v uv >/dev/null 2>&1; then
  echo "[prepare-desktop-bundle] 缺少 uv，请先安装 uv" >&2
  exit 1
fi

TARGET_TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-}"
if [[ -z "$TARGET_TRIPLE" ]]; then
  TARGET_TRIPLE="$(rustc -vV | awk '/host: / { print $2 }')"
fi

if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "[prepare-desktop-bundle] 无法识别 target triple" >&2
  exit 1
fi

SUFFIX=""
if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  SUFFIX=".exe"
fi

echo "[prepare-desktop-bundle] 打包 Python 侧车 ($TARGET_TRIPLE)..."
uv run --directory "$PY_DIR" --with pyinstaller \
  pyinstaller --noconfirm --clean --onefile app.py --name "$BASE_NAME"

SRC_BIN="$PY_DIR/dist/$BASE_NAME$SUFFIX"
DST_BIN="$BIN_DIR/$BASE_NAME-$TARGET_TRIPLE$SUFFIX"

if [[ ! -f "$SRC_BIN" ]]; then
  echo "[prepare-desktop-bundle] 未找到侧车产物: $SRC_BIN" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cp "$SRC_BIN" "$DST_BIN"
chmod +x "$DST_BIN" || true

BIN_SIZE=$(wc -c < "$DST_BIN" | tr -d '[:space:]')
if [[ -z "$BIN_SIZE" || "$BIN_SIZE" -lt 1000000 ]]; then
  echo "[prepare-desktop-bundle] 侧车体积异常($BIN_SIZE bytes): $DST_BIN" >&2
  echo "[prepare-desktop-bundle] 预期为 PyInstaller 产物，请检查 uv/pyinstaller 是否执行成功" >&2
  exit 1
fi

echo "[prepare-desktop-bundle] 构建 Nuxt 前端产物..."
cd "$ROOT_DIR"
npm run build

echo "[prepare-desktop-bundle] 完成: $DST_BIN"
