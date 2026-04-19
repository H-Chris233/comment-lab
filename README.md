# Comment Lab

轻量版评论生成 MVP（Nuxt 3 单体应用）。

## 当前模型适配

- 当前目标模型：`qwen3.5-omni-plus`
- 当前调用方式：OpenAI 兼容接口
- 当前输出模式：文本（`modalities: ["text"]`）
- 当前请求模式：流式聚合后返回

## 启动

```bash
cp .env.example .env
npm install
npm run dev
```

## 关键环境变量

- `ALIYUN_API_KEY`: 阿里云百炼 API Key（仅服务端）
- `ALIYUN_BASE_URL`: OpenAI 兼容接口地址（需与账号地域一致）
- `ALIYUN_MODEL`: 默认模型名（建议 `qwen3.5-omni-plus`）
- `TIKHUB_API_KEY`: TikHub API Key（抖音解析）
- `TIKHUB_BASE_URL`: TikHub API 地址（默认 `https://api.tikhub.io`）
- `MAX_VIDEO_SIZE_MB`: 前端/服务端上传大小限制（默认 100）

## 限制说明

- 产品当前前端上传限制：100MB（可通过 `MAX_VIDEO_SIZE_MB` 调整）
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

- 支持 `TXT`、`Word`（`.doc`）、`CSV`
- `TXT` / `Word` 统一按行导出，每条一行


## 数量设置

- 预设：180 / 360 / 540 / 720
- 自定义：1 ~ 1500
- 每次生成会并行发起长 / 中 / 短 3 路调用，每路 60 条


## 抖音链接链路

- 当前链接模式已接入 TikHub（仅抖音 API）
- 服务端通过 TikHub 解析分享链接并提取视频直链，再直接调用模型


## 默认提示词文件

- 默认提示词放在 `public/default-prompt.txt`
- 页面加载时会自动读取该文件作为基础提示词初始值
- 三路生成模板放在 `prompts/long.txt`、`prompts/medium.txt`、`prompts/short.txt`
