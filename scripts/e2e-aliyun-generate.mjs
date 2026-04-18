#!/usr/bin/env node

import fs from 'node:fs'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const VIDEO_PATH = process.env.E2E_VIDEO_FILE

if (!VIDEO_PATH) {
  console.error('[e2e] 缺少 E2E_VIDEO_FILE，例如：E2E_VIDEO_FILE=./samples/demo.mp4 npm run e2e:aliyun')
  process.exit(1)
}

if (!fs.existsSync(VIDEO_PATH)) {
  console.error(`[e2e] 视频文件不存在: ${VIDEO_PATH}`)
  process.exit(1)
}

async function run() {
  const health = await fetch(`${BASE_URL}/api/health`)
  const healthJson = await health.json()
  if (!health.ok || !healthJson.ok) {
    throw new Error(`[e2e] health 失败: ${JSON.stringify(healthJson)}`)
  }

  const form = new FormData()
  form.append('mode', 'upload')
  form.append('count', '100')
  form.append('basePrompt', '生成口语化、自然、短句为主的中文评论')
  form.append('extraPrompt', '避免重复，语气轻松')
  form.append('dedupe', 'true')
  form.append('cleanEmpty', 'true')

  const buf = fs.readFileSync(VIDEO_PATH)
  const blob = new Blob([buf], { type: 'video/mp4' })
  form.append('video', blob, 'e2e-video.mp4')

  const startedAt = Date.now()
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    body: form
  })
  const json = await res.json()
  const durationMs = Date.now() - startedAt

  if (!res.ok || !json.ok) {
    console.error('[e2e] generate 失败', {
      status: res.status,
      requestId: json.requestId,
      code: json.code,
      message: json.message,
      finalCount: json?.data?.finalCount,
      requestedCount: json?.data?.requestedCount,
      durationMs
    })
    process.exit(1)
  }

  console.log('[e2e] 通过', {
    requestId: json.requestId,
    model: json.data.model,
    requestedCount: json.data.requestedCount,
    finalCount: json.data.finalCount,
    beforeNormalizeCount: json.data.beforeNormalizeCount,
    afterNormalizeCount: json.data.afterNormalizeCount,
    durationMs
  })
}

run().catch((error) => {
  console.error('[e2e] 异常', error instanceof Error ? error.message : error)
  process.exit(1)
})
