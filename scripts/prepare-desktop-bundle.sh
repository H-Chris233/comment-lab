#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_DIR="$ROOT_DIR/python_service"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"
PY_BASE_NAME="comment-lab-python-sidecar"
NODE_BASE_NAME="comment-lab-node-server"
FFMPEG_BASE_NAME="comment-lab-ffmpeg"

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
PKG_TARGET=""
if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  SUFFIX=".exe"
  PKG_TARGET="node18-win-x64"
elif [[ "$TARGET_TRIPLE" == *"apple-darwin"* ]]; then
  if [[ "$TARGET_TRIPLE" == aarch64* ]]; then
    PKG_TARGET="node18-macos-arm64"
  else
    PKG_TARGET="node18-macos-x64"
  fi
elif [[ "$TARGET_TRIPLE" == *"unknown-linux-gnu"* ]]; then
  if [[ "$TARGET_TRIPLE" == aarch64* ]]; then
    PKG_TARGET="node18-linux-arm64"
  else
    PKG_TARGET="node18-linux-x64"
  fi
else
  echo "[prepare-desktop-bundle] 暂不支持 target triple: $TARGET_TRIPLE" >&2
  exit 1
fi

echo "[prepare-desktop-bundle] 构建 Nuxt 产物..."
cd "$ROOT_DIR"
npm run build

echo "[prepare-desktop-bundle] 打包 Node 本地服务侧车 ($PKG_TARGET)..."
NODE_SRC="$ROOT_DIR/.output/server/index.mjs"
if [[ ! -f "$NODE_SRC" ]]; then
  echo "[prepare-desktop-bundle] 未找到 Nuxt server 入口: $NODE_SRC" >&2
  exit 1
fi

NODE_OUT_DIR="$ROOT_DIR/.output/desktop"
mkdir -p "$NODE_OUT_DIR"
NODE_OUT="$NODE_OUT_DIR/$NODE_BASE_NAME$SUFFIX"
PKG_STAGE_DIR="$NODE_OUT_DIR/pkg-input"
rm -rf "$PKG_STAGE_DIR"
mkdir -p "$PKG_STAGE_DIR"
cp -R "$ROOT_DIR/.output/server" "$PKG_STAGE_DIR/server"
cat > "$PKG_STAGE_DIR/launcher.cjs" <<'EOF'
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const entry = pathToFileURL(path.join(__dirname, 'server', 'index.mjs')).href;
import(entry).catch((error) => {
  console.error('[node-sidecar] failed to import server entry:', error);
  process.exit(1);
});
EOF

npx --yes pkg "$PKG_STAGE_DIR/launcher.cjs" \
  --targets "$PKG_TARGET" \
  --assets "$PKG_STAGE_DIR/server/**/*" \
  --assets "$ROOT_DIR/prompts/*.txt" \
  --output "$NODE_OUT"

echo "[prepare-desktop-bundle] 打包 Python 侧车 ($TARGET_TRIPLE)..."
uv run --directory "$PY_DIR" --with pyinstaller \
  pyinstaller --noconfirm --clean --onefile app.py --name "$PY_BASE_NAME"

PY_SRC_BIN="$PY_DIR/dist/$PY_BASE_NAME$SUFFIX"
PY_DST_BIN="$BIN_DIR/$PY_BASE_NAME-$TARGET_TRIPLE$SUFFIX"
NODE_DST_BIN="$BIN_DIR/$NODE_BASE_NAME-$TARGET_TRIPLE$SUFFIX"
FFMPEG_DST_BIN="$BIN_DIR/$FFMPEG_BASE_NAME-$TARGET_TRIPLE$SUFFIX"

if [[ ! -f "$PY_SRC_BIN" ]]; then
  echo "[prepare-desktop-bundle] 未找到 Python 侧车产物: $PY_SRC_BIN" >&2
  exit 1
fi
if [[ ! -f "$NODE_OUT" ]]; then
  echo "[prepare-desktop-bundle] 未找到 Node 侧车产物: $NODE_OUT" >&2
  exit 1
fi
FFMPEG_BIN="${FFMPEG_BINARY:-}"
if [[ -z "$FFMPEG_BIN" ]]; then
  FFMPEG_BIN="$(command -v ffmpeg || true)"
fi
if [[ -z "$FFMPEG_BIN" ]]; then
  echo "[prepare-desktop-bundle] 缺少 ffmpeg，请先安装 ffmpeg 后再构建桌面包" >&2
  exit 1
fi
if [[ ! -f "$FFMPEG_BIN" ]]; then
  echo "[prepare-desktop-bundle] FFMPEG_BINARY 不存在: $FFMPEG_BIN" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod u+w "$PY_DST_BIN" "$NODE_DST_BIN" "$FFMPEG_DST_BIN" 2>/dev/null || true
rm -f "$PY_DST_BIN" "$NODE_DST_BIN" "$FFMPEG_DST_BIN"
install -m 0755 "$PY_SRC_BIN" "$PY_DST_BIN"
install -m 0755 "$NODE_OUT" "$NODE_DST_BIN"
install -m 0755 "$FFMPEG_BIN" "$FFMPEG_DST_BIN"

if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  FFMPEG_SRC_DIR="$(cd "$(dirname "$FFMPEG_BIN")" && pwd)"
  shopt -s nullglob
  for dll in "$FFMPEG_SRC_DIR"/*.dll; do
    install -m 0644 "$dll" "$BIN_DIR/$(basename "$dll")"
  done
  shopt -u nullglob
fi

PY_BIN_SIZE=$(wc -c < "$PY_DST_BIN" | tr -d '[:space:]')
if [[ -z "$PY_BIN_SIZE" || "$PY_BIN_SIZE" -lt 1000000 ]]; then
  echo "[prepare-desktop-bundle] Python 侧车体积异常($PY_BIN_SIZE bytes): $PY_DST_BIN" >&2
  exit 1
fi

NODE_BIN_SIZE=$(wc -c < "$NODE_DST_BIN" | tr -d '[:space:]')
if [[ -z "$NODE_BIN_SIZE" || "$NODE_BIN_SIZE" -lt 1000000 ]]; then
  echo "[prepare-desktop-bundle] Node 侧车体积异常($NODE_BIN_SIZE bytes): $NODE_DST_BIN" >&2
  exit 1
fi

if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  if ! "$FFMPEG_BIN" -version >/dev/null 2>&1; then
    echo "[prepare-desktop-bundle] ffmpeg 源可执行校验失败: $FFMPEG_BIN" >&2
    exit 1
  fi
else
  if ! PATH="$BIN_DIR:$PATH" "$FFMPEG_DST_BIN" -version >/dev/null 2>&1; then
    echo "[prepare-desktop-bundle] ffmpeg 可执行校验失败: $FFMPEG_DST_BIN" >&2
    exit 1
  fi
fi

echo "[prepare-desktop-bundle] 完成: $PY_DST_BIN, $NODE_DST_BIN, $FFMPEG_DST_BIN"
