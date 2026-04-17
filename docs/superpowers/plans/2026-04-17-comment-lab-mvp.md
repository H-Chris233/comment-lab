# Comment Lab MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可上传视频/输入抖音链接并生成评论、支持复制与 TXT/CSV 导出的 Nuxt 3 单体 MVP。

**Architecture:** 前端单页承载输入/参数/结果；Nuxt Server Routes 负责解析链接、接收视频、拼接 Prompt、调用阿里云兼容 OpenAI 接口并清洗输出；服务按 `api -> services -> utils/types` 分层。

**Tech Stack:** Nuxt 3, Vue 3, TypeScript, Nitro, TailwindCSS（可后补）, OpenAI SDK 兼容调用。

---

### Task 1: 项目初始化与基础配置

**Files:**
- Create: `package.json`
- Create: `nuxt.config.ts`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] Step 1: 初始化 Nuxt 3 + TS 依赖声明
- [ ] Step 2: 配置 runtimeConfig（aliyun/douyin/public.appName）
- [ ] Step 3: 补充 `.env.example` 与敏感信息说明
- [ ] Step 4: 运行 `npm install` 与 `npm run prepare`

### Task 2: 类型与常量定义

**Files:**
- Create: `types/api.ts`
- Create: `types/comment.ts`
- Create: `types/prompt.ts`

- [ ] Step 1: 定义 `GenerateRequestPayload` / `GenerateResponse`
- [ ] Step 2: 定义 `CommentItem` 与提示词参数类型
- [ ] Step 3: 定义默认常量（DEFAULT_PROMPT / DEFAULT_EXTRA_PROMPT / DEFAULT_MODEL）

### Task 3: 后端服务层实现

**Files:**
- Create: `server/services/prompt.ts`
- Create: `server/services/normalize.ts`
- Create: `server/services/ai.ts`
- Create: `server/services/douyin.ts`
- Create: `server/services/file.ts`
- Create: `server/utils/validators.ts`
- Create: `server/utils/response.ts`
- Create: `server/utils/errors.ts`

- [ ] Step 1: 实现 `buildPrompt` 拼接规则
- [ ] Step 2: 实现 `normalizeComments`（分行、去空、去编号、去重）
- [ ] Step 3: 封装 `createAliyunClient` 与模型调用入口
- [ ] Step 4: 封装抖音链接解析服务调用
- [ ] Step 5: 实现请求参数与文件校验（格式/大小/必填）

### Task 4: API 路由实现

**Files:**
- Create: `server/api/health.get.ts`
- Create: `server/api/parse-link.post.ts`
- Create: `server/api/generate.post.ts`

- [ ] Step 1: `GET /api/health` 返回 `{ ok: true }`
- [ ] Step 2: `POST /api/parse-link` 调用 douyin service 并统一失败提示
- [ ] Step 3: `POST /api/generate` 解析 multipart、分流 link/upload、调用 ai/prompt/normalize
- [ ] Step 4: 覆盖错误分支与统一返回结构

### Task 5: 前端页面与组件

**Files:**
- Create: `app.vue`
- Create: `pages/index.vue`
- Create: `components/VideoInput.vue`
- Create: `components/PromptEditor.vue`
- Create: `components/GeneratePanel.vue`
- Create: `components/ResultToolbar.vue`
- Create: `components/CommentList.vue`

- [ ] Step 1: 按 5 区块完成首页布局
- [ ] Step 2: 实现链接/上传模式切换与状态提示
- [ ] Step 3: 实现参数区（count/outputFormat/dedupe/cleanEmpty）
- [ ] Step 4: 结果区支持单条复制、删除、重生成入口

### Task 6: Composable 与导出能力

**Files:**
- Create: `composables/useGenerate.ts`
- Create: `composables/useExport.ts`

- [ ] Step 1: `useGenerate` 封装表单组装、调用 `/api/generate`、错误处理
- [ ] Step 2: `useExport` 实现复制全部、导出 TXT、导出 CSV
- [ ] Step 3: 接入页面并打通端到端流程

### Task 7: 验证与交付

**Files:**
- Modify: `README.md`（若不存在则创建）

- [ ] Step 1: 运行 `npm run typecheck`（或 `nuxt typecheck`）
- [ ] Step 2: 运行 `npm run lint`（若未配置则至少执行 `npm run build`）
- [ ] Step 3: 手动验证 3 条主链路：上传生成、链接解析失败回退、TXT/CSV 导出
- [ ] Step 4: 补充启动与环境变量说明
