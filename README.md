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
- `DOUYIN_API_BASE`: 第三方抖音解析服务地址
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

- `text`: 按行文本清洗
- `json`: 强制按 JSON 数组解析；若模型未返回合法数组会返回 `MODEL_OUTPUT_INVALID_FORMAT`


## 数量设置

- 预设：100 / 200 / 300
- 自定义：1 ~ 500


## 抖音链接默认链路（已切换）

- 默认链接模式使用 `douyin-downloader`（Puppeteer）在服务端拉取视频
- 下载到私有临时目录（`TEMP_VIDEO_DIR`）后转 Base64 Data URL 送模型
- 不要求无水印，仅保证可拉取并进入生成链路
- 生产环境建议预装 Chromium 运行依赖（如 libnss3、fonts 等），保证 Puppeteer 可用


## 默认提示词文件

- 默认提示词放在 `public/default-prompt.txt`
- 页面加载时会自动读取该文件作为基础提示词初始值
