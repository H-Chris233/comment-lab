# Comment Lab

Comment Lab 是一个轻量版评论生成 MVP：Nuxt 3 前端/服务端负责页面、认证、抖音解析、视频下载/压缩、结果清洗与导出；Python FastAPI 侧车负责通过 DashScope Python SDK 调用阿里云百炼多模态模型。

## 当前状态

- 应用形态：Web 单体应用 + Python DashScope 侧车；当前仓库没有桌面/Tauri 打包入口。
- 默认模型：`qwen3.5-omni-plus`。
- 可选模型：`qwen3.5-omni-plus`、`qwen3.5-plus`、`qwen3.6-plus`。
- 思考模式：仅 `qwen3.5-plus` / `qwen3.6-plus` 支持；页面切换到支持模型时默认开启，切换到不支持模型时自动关闭；Python 侧车启用时传入 `thinking_budget=4096`。
- 模型调用：Python 侧车调用 `dashscope.MultiModalConversation.call()`，视频输入支持远程 URL 或本地文件 URI；当前前端固定走文件传输链路。
- 生成响应：`/api/generate` 默认由前端以 SSE 流式接收状态、心跳、单条评论、分轮结果和最终结果。
- 认证：首次访问创建全站统一密码，之后使用 HTTP-only 会话 Cookie 解锁；密码状态写入 `AUTH_LOCK_FILE`。

## 运行要求

- Node.js：建议使用 Node 22（Dockerfile 使用 `node:22-bookworm-slim`）。
- 包管理：仓库保留 `pnpm-lock.yaml`，Docker 构建使用 pnpm；本地脚本也可通过 `npm run ...` 调用。
- Python：本地脚本使用 `uv` 启动 Python 3.13 侧车；`python_service/pyproject.toml` 允许 `>=3.11,<3.14`。
- 可选系统依赖：视频压缩依赖 `ffmpeg`；Docker App 镜像会安装，本机运行如需压缩大视频需自行安装。

## 本地启动

先复制环境变量模板并安装依赖：

```bash
cp .env.example .env
corepack enable
pnpm install
npm run python:sync
```

### 一键开发启动

```bash
npm run dev:all
```

这会同时启动：

- Python DashScope 侧车：`http://127.0.0.1:8001`
- Nuxt 开发服务：默认 `http://localhost:3000`

### 分开启动

终端 1：

```bash
npm run python:dev
```

终端 2：

```bash
npm run dev
```

### 本机生产启动

```bash
npm run start:prod
```

这会先执行 Nuxt build，再启动 Python 侧车和 Nuxt 生产预览。生产预览端口可通过 `APP_PORT` 覆盖。

## Docker 部署

仓库提供 `docker-compose.yml`，会启动两个服务：

- `python`：FastAPI + DashScope Python SDK 侧车。
- `app`：Nuxt/Nitro 服务，依赖 Python 侧车健康检查。

启动：

```bash
cp .env.example .env
npm run docker:up
```

停止：

```bash
npm run docker:down
```

默认对外端口是 `3000`。如果宿主机端口被占用：

```bash
APP_PORT=3001 npm run docker:up
```

Docker Compose 使用两个 named volume：

- `commentlab_tmp`：共享临时视频目录，供 Node 服务和 Python 侧车访问同一份下载/上传文件。
- `commentlab_auth`：持久化密码锁状态。需要重置密码时删除该 volume。

## 关键环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ALIYUN_API_KEY` | 空 | 阿里云百炼/DashScope API Key；Python 侧车也兼容 `DASHSCOPE_API_KEY`、`ALIYUN_DASHSCOPE_API_KEY`。 |
| `ALIYUN_BASE_URL` | `https://dashscope.aliyuncs.com/api/v1` | DashScope HTTP API 地址；Python 侧车也兼容 `DASHSCOPE_HTTP_BASE_URL`。 |
| `ALIYUN_MODEL` | `qwen3.5-omni-plus` | 默认模型，同时用于 Nuxt public 默认模型。 |
| `TIKHUB_API_KEY` | 空 | TikHub API Key，用于抖音链接解析。 |
| `TIKHUB_BASE_URL` | `https://api.tikhub.io` | TikHub API 地址。 |
| `MAX_VIDEO_SIZE_MB` | `1000` | 上传文件大小上限。 |
| `MAX_COMPRESS_VIDEO_SIZE_MB` | `100` | 下载/上传后进入模型前的视频压缩目标上限。 |
| `GENERATE_TIMEOUT_MS` | `3600000` | 前端/服务端生成请求超时，默认 1 小时。 |
| `TEMP_VIDEO_RETENTION_MINUTES` | `10` | 临时视频保留时长。 |
| `TEMP_VIDEO_DIR` | `.tmp/douyin-downloads` | 临时视频目录。 |
| `AUTH_LOCK_FILE` | `.tmp/auth-lock.json` | 密码锁状态文件；Docker 中映射到 `/app/.state/auth-lock.json`。 |
| `PYTHON_DASHSCOPE_SERVICE_URL` | `http://127.0.0.1:8001` | Nuxt 服务访问 Python 侧车的地址；Docker 中为 `http://python:8001`。 |
| `DEBUG_RAW_ENABLED` | `false` | 设为 `true` 后结果区可显示原始模型输出和提示词追踪。 |
| `APP_PORT` | `3000` | Docker 端口映射和本机生产预览端口。 |
| `PIP_INDEX_URL` / `UV_INDEX_URL` | 清华源 | Docker Python 镜像构建时的 Python 包索引。 |

> 说明：Docker Compose 会把 `.env` 传给两个容器，并为 Nuxt 注入所需的 `NUXT_*` runtimeConfig 覆盖项。

## 功能链路

### 输入方式

- 抖音链接：服务端校验 `douyin.com` / `v.douyin.com` / `iesdouyin.com` 域名，经 TikHub 解析视频信息，再下载到临时目录后调用模型。
- 本地上传：支持 `mp4`、`mov`、`webm`，上传后保存到临时目录再调用模型。

抖音链接下载失败时，服务端会重新解析链接并再尝试一次下载。下载过程会通过 SSE 返回进度；中断下载会显示继续下载/重试状态。

### 视频压缩

当下载或上传后的视频超过 `MAX_COMPRESS_VIDEO_SIZE_MB` 时，服务端会调用 `ffmpeg` 尝试压缩到 720p H.264/AAC：

1. `veryfast @ crf 30`
2. `slow @ crf 34`

如果本机缺少 `ffmpeg`，压缩阶段会返回“未找到 ffmpeg，请先安装后重试”。

### 生成数量与分轮

- 页面预设：`50` / `150` / `200`。
- 默认自定义值：`100`。
- 自定义范围：`1 ~ 1500`。
- 服务端按短/中/长三类风格拆分目标：短 40%、中 40%、长 20%。
- 每轮按剩余数量继续补齐，最大轮数为 `max(2, ceil(count / 50) + 2)`。

### 提示词与长度桶

提示词模板位于 `prompts/`：

- `prompts/short.txt`：短评论模板，目标 ≤10 字。
- `prompts/medium.txt`：中评论模板，目标 10–20 字。
- `prompts/long.txt`：长评论模板，目标 20–30 字。
- `prompts/bundle.txt`：精确字数分段模板，供长度桶/精确长度逻辑使用。

服务端会把视频标题、当前长度桶、长度范围、子区间和页面“附加提示词”渲染进模板。附加提示词可为空，最大 6000 字符。

### 后处理规则

服务端会对模型输出做清洗：

- 删除序号、项目符号、说明性前缀和空行。
- 可选去重、可选清理空行。
- 过滤可见长度小于 4 或大于 30、摘要腔、禁用词、BGM/拍摄手法评价等不合规评论。
- 规范 emoji、标点和逗号分布；默认 emoji 后处理比例为 15%。
- 最终结果会裁剪到请求数量，并在前端支持打乱、复制、删除单条、重新生成。

## API

所有业务 API 都受密码锁保护；未解锁时返回 `UNAUTHORIZED`。

- `GET /api/health`：服务健康检查。
- `GET /api/auth/status`：查询是否已设置密码及当前会话是否已认证。
- `POST /api/auth/set-password`：首次设置密码。
- `POST /api/auth/login`：登录解锁。
- `POST /api/auth/logout`：退出当前会话。
- `POST /api/auth/change-password`：修改密码。
- `POST /api/parse-link`：解析抖音链接，返回视频 URL、标题和封面。
- `POST /api/generate?stream=1`：生成评论，`multipart/form-data`，前端使用 SSE 流式响应。

`/api/generate` 主要字段：

- `mode`: `link` 或 `upload`。
- `inputMode`: `url` 或 `file`；兼容旧值 `base64`（按 `file` 处理）；当前前端固定传 `file`。
- `model`: 可选模型名。
- `enableThinking`: 是否请求思考模式；仅支持模型会生效。
- `url`: 链接模式下的抖音 URL。
- `video`: 上传模式下的视频文件。
- `count`: 生成数量。
- `basePrompt`: 附加提示词。
- `dedupe`: 是否去重。
- `cleanEmpty`: 是否清理空行。

## 导出与调试

- 支持复制全部评论。
- 支持导出 `TXT`。
- 支持导出 Word 兼容的 `.doc`。
- 文件名格式：`comments_YYYY-MM-DD_<条数>.txt/.doc`。
- 设置 `DEBUG_RAW_ENABLED=true` 后，结果区可显示原始模型输出和提示词追踪，用于排查条数不足、清洗过度或提示词漂移。

## 联调与验收

### 单元/API 测试

```bash
npm run test
npm run typecheck
```

测试覆盖认证、健康检查、抖音解析、生成 API、环境变量、导出、文件下载/恢复、视频压缩、提示词、后处理、思考模式和前端生成组合逻辑。

### 真实链路 E2E（阿里云）

确保服务已启动、密码锁已解锁、`.env` 已配置 `ALIYUN_API_KEY` 和 `TIKHUB_API_KEY`，然后执行：

```bash
E2E_BASE_URL=http://localhost:3000 E2E_VIDEO_FILE=./your-video.mp4 npm run e2e:aliyun
```

脚本会输出 `requestId`、模型名、请求条数和清洗后条数，便于联调排障。

## 已知边界

- 上传文件大小受 `MAX_VIDEO_SIZE_MB` 限制；链接下载本身不按该值拦截，但下载/上传后会按 `MAX_COMPRESS_VIDEO_SIZE_MB` 判断是否需要压缩。
- 视频压缩需要本机或容器内可用的 `ffmpeg`。
- 生成质量和耗时受模型、视频长度、网络、TikHub 可用性、DashScope 区域/API Key 和 `GENERATE_TIMEOUT_MS` 影响。
- 当前前端固定将链接解析后的视频下载成本地文件再交给 Python 侧车，便于与上传链路共用清洗、压缩和临时文件处理。
