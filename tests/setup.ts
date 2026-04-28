import { defineEventHandler, readBody, readMultipartFormData, setResponseStatus } from 'h3'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { beforeEach } from 'vitest'

const authLockFile = path.join(process.cwd(), '.tmp', `test-auth-lock-${process.pid}.json`)

beforeEach(() => {
  rmSync(authLockFile, { force: true })
})

Object.assign(globalThis, {
  defineEventHandler,
  readBody,
  readMultipartFormData,
  setResponseStatus,
  useRuntimeConfig: () => ({
    aliyunApiKey: 'test-key',
    aliyunBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    aliyunModel: 'qwen3.5-omni-plus',
    douyinApiBase: 'https://parser.example.com',
    maxVideoSizeMb: 1000,
    maxDownloadVideoSizeMb: Number.POSITIVE_INFINITY,
    maxCompressVideoSizeMb: 100,
    public: {
      defaultModel: 'qwen3.5-omni-plus'
    },
    tempVideoRetentionMinutes: 10,
    pythonDashscopeServiceUrl: 'http://127.0.0.1:8001',
    authLockFile
  })
})
