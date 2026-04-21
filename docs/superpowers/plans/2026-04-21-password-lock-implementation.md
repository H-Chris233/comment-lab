# 密码锁页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Comment Lab 增加一个全站统一密码锁，支持首次设置密码、会话级解锁、主页面修改密码，并保护核心 API。

**Architecture:** 服务端用本地 JSON 文件保存密码哈希和会话签名密钥；通过 HTTP-only 会话 Cookie 记录解锁状态；前端在进入主页面前先查询认证状态，再根据状态显示锁页或主页面。核心生成 API 统一复用同一套鉴权检查。

**Tech Stack:** Nuxt 3, Nitro server routes, Vue 3, TypeScript, Node crypto, h3, vitest.

---

### Task 1: 定义认证类型与持久化服务

**Files:**
- Create: `server/services/auth.ts`
- Modify: `server/utils/validators.ts`
- Modify: `types/api.ts`
- Modify: `nuxt.config.ts`

- [ ] **Step 1: 写认证状态文件读写、密码哈希、会话 Cookie 签名/验签**
- [ ] **Step 2: 增加密码校验与状态查询辅助函数**
- [ ] **Step 3: 补充 runtimeConfig 的 auth 文件路径**
- [ ] **Step 4: 为基础工具补单测**

### Task 2: 增加认证 API

**Files:**
- Create: `server/api/auth/status.get.ts`
- Create: `server/api/auth/login.post.ts`
- Create: `server/api/auth/set-password.post.ts`
- Create: `server/api/auth/change-password.post.ts`
- Create: `server/api/auth/logout.post.ts`
- Create: `tests/api/auth.api.test.ts`

- [ ] **Step 1: 写状态 / 登录 / 初始化 / 改密 / 退出 API**
- [ ] **Step 2: 确认 Cookie 发放与清理行为**
- [ ] **Step 3: 覆盖首次设置、密码错误、改密成功/失败用例**

### Task 3: 保护核心业务 API

**Files:**
- Modify: `server/api/generate.post.ts`
- Modify: `server/api/parse-link.post.ts`
- Modify: `tests/api/generate.api.test.ts`
- Modify: `tests/api/parse-link.api.test.ts`

- [ ] **Step 1: 在核心路由入口加入鉴权检查**
- [ ] **Step 2: 给现有 API 测试补鉴权绕过 mock**
- [ ] **Step 3: 补一个未登录访问返回 401 的回归测试**

### Task 4: 前端锁页与改密入口

**Files:**
- Create: `components/PasswordPanel.vue`
- Modify: `pages/index.vue`
- Create: `composables/useAuth.ts`
- Modify: `components/GenerationPanel.vue`（如需要）

- [ ] **Step 1: 实现认证状态加载、登录、首次设置、改密动作**
- [ ] **Step 2: 页面在未解锁时只显示锁页**
- [ ] **Step 3: 解锁后显示原主页面并挂上改密入口**
- [ ] **Step 4: 保持刷新后仍能恢复解锁状态**

### Task 5: 验证与收尾

**Files:**
- Modify: `README.md`
- Modify: `.env.example`（如需要）

- [ ] **Step 1: 跑认证相关 API 测试**
- [ ] **Step 2: 跑 typecheck**
- [ ] **Step 3: 确认锁页 / 主页面切换和改密流程**
- [ ] **Step 4: 更新启动与配置说明**

