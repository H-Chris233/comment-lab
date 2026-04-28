# Comment Lab

轻量版评论生成 MVP（Nuxt 3 单体应用）。

## 当前模型适配

- 当前目标模型：`qwen3.5-omni-plus`
- 当前调用方式：Python 侧车 + DashScope Python SDK
- 当前输出模式：文本（`modalities: ["text"]`）
- 当前请求模式：流式聚合后返回

## 启动

### 一键启动

```bash
npm run dev:all
```

这会同时启动：
- Nuxt 主服务
- Python DashScope 侧车

### 桌面启动

如果你要以桌面程序形式打开，可以用 Tauri：

```bash
npm run desktop:dev
```

这会先启动本地 Nuxt + Python 服务，再打开一个桌面窗口。
当前桌面版仍然是“本地服务 + 桌面壳”的结构，不是把所有后端逻辑完全搬进 Rust。

### 桌面打包

```bash
npm run desktop:build
```

打包流程会自动执行两步：
1. 用 `PyInstaller` 将 `python_service/app.py` 打成独立侧车可执行文件（内含 Python 运行时 + DashScope SDK）。
2. 再执行 Tauri 打包，把该侧车随桌面应用一起发布。

因此目标机器不需要单独安装 Node.js / Python 运行时。

当前 Linux 发布包默认产出 `.deb` 和 `.rpm`，先不打 AppImage，避免额外的打包依赖卡住发布流程。

### 分开启动

```bash
cp .env.example .env
npm install
uv sync --directory python_service --python 3.13
npm run dev
```

另起一个终端启动 Python 侧车：

```bash
npm run python:dev
```

`python:dev` 会通过 `uv` 自动创建/复用 Python 环境并启动侧车服务。

## 本机生产启动

如果你不使用 Docker，可以直接：

```bash
cp .env.example .env
npm run start:prod
```

这会先执行 Nuxt build，再同时启动：
- Python DashScope 侧车
- Nuxt 生产预览

## 生产部署

仓库已提供 `docker-compose.yml`，生产环境可以一条命令直接拉起：

```bash
cp .env.example .env
npm run docker:up
```

这会同时启动：
- Nuxt App 容器
- Python DashScope 侧车容器

首次访问会先进入密码锁：如果还没设置密码，先创建一个全站统一密码；如果已经设置过，先输入密码解锁。解锁状态只保持到当前浏览器会话结束，刷新页面仍然有效。

两者共享同一个临时视频卷，确保下载到本地的视频在两个容器里都能访问。

密码状态会单独写入一个 `commentlab_auth` named volume，容器重建后仍会保留；如果你希望重置密码，删除这个 volume 即可。

默认对外端口是 `3000`，如果宿主机这个端口已被占用，可以这样改：

```bash
APP_PORT=3001 npm run docker:up
```

如需停止：

```bash
npm run docker:down
```

## 关键环境变量

- `ALIYUN_API_KEY`: 阿里云百炼 API Key（仅服务端）
- `ALIYUN_BASE_URL`: OpenAI 兼容接口地址（需与账号地域一致）
- `ALIYUN_MODEL`: 默认模型名（建议 `qwen3.5-omni-plus`）
- `TIKHUB_API_KEY`: TikHub API Key（抖音解析）
- `TIKHUB_BASE_URL`: TikHub API 地址（默认 `https://api.tikhub.io`）
- `MAX_VIDEO_SIZE_MB`: 前端/服务端上传大小限制（默认 1000）
- `GENERATE_TIMEOUT_MS`: 前端/服务端生成请求超时（默认 3600000，即 1 小时）
- `AUTH_LOCK_FILE`: 密码锁状态文件路径（本地默认 `.tmp/auth-lock.json`；Docker Compose 会改用独立持久化卷）
- `PYTHON_DASHSCOPE_SERVICE_URL`: Python 侧车地址（默认 `http://127.0.0.1:8001`）

> 说明：Docker Compose 会把这份 `.env` 同时传给两个容器，并额外注入 `NUXT_*` 变量供 Nuxt runtimeConfig 覆盖。

## 限制说明

- 产品当前前端上传限制：1000MB（可通过 `MAX_VIDEO_SIZE_MB` 调整）
- 模型能力可支持长视频理解，但实际体验仍受上传体积、网络和服务超时影响

## API

- `GET /api/health`
- `POST /api/parse-link`
- `POST /api/generate` (multipart/form-data)


## 联调与验收

### 前端调试模式

设置 `DEBUG_RAW_ENABLED=true` 后，结果区可手动勾选“显示原始模型输出”，用于排查条数不足、清洗过度等问题。

### 真实链路 E2E 验收（阿里云）

确保服务已启动，然后执行：

```bash
E2E_BASE_URL=http://localhost:3000 E2E_VIDEO_FILE=./your-video.mp4 npm run e2e:aliyun
```

脚本会输出 requestId、模型名、请求条数与清洗后条数，便于联调排障。


## 输出格式

- 支持 `TXT`、`Word`（`.doc`）
- `TXT` / `Word` 统一按行导出，每条一行


## 数量设置

- 预设：100 / 200 / 300
- 自定义：1 ~ 1500
- 每次生成会按 6 个长度桶拆分目标条数，并在目标数为 0 时跳过对应请求


## 抖音链接链路

- 当前链接模式已接入 TikHub（仅抖音 API）
- 服务端通过 TikHub 解析分享链接并提取视频直链，再直接调用模型


## 提示词文件

- 三路生成模板放在 `prompts/long.txt`、`prompts/medium.txt`、`prompts/short.txt`
- 每个模板都内置了通用评论规则和各自的风格限制，三份文件可以独立编辑
- 页面里的“附加提示词”是可选项，不填也能直接生成
