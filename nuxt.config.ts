import { parseBooleanEnv } from './utils/env'
import { DEFAULT_MODEL } from './types/prompt'

export default defineNuxtConfig({
  compatibilityDate: '2025-10-10',
  devtools: { enabled: true },
  vite: {
    server: {
      allowedHosts: ['test.qmx.qzz.io']
    }
  },
  runtimeConfig: {
    aliyunApiKey: process.env.ALIYUN_API_KEY,
    aliyunBaseUrl: process.env.ALIYUN_BASE_URL,
    aliyunModel: process.env.ALIYUN_MODEL,
    tikhubApiKey: process.env.TIKHUB_API_KEY,
    tikhubBaseUrl: process.env.TIKHUB_BASE_URL || 'https://api.tikhub.io',
    maxVideoSizeMb: Number(process.env.MAX_VIDEO_SIZE_MB || 500),
    maxDownloadVideoSizeMb: Number.POSITIVE_INFINITY,
    maxCompressVideoSizeMb: Number(process.env.MAX_COMPRESS_VIDEO_SIZE_MB || 100),
    tempVideoRetentionMinutes: Number(process.env.TEMP_VIDEO_RETENTION_MINUTES || 10),
    tempVideoDir: process.env.TEMP_VIDEO_DIR,
    authLockFile: process.env.AUTH_LOCK_FILE || '.tmp/auth-lock.json',
    pythonDashscopeServiceUrl: process.env.PYTHON_DASHSCOPE_SERVICE_URL || 'http://127.0.0.1:8001',
    public: {
      appName: 'Comment Lab',
      debugRawEnabled: parseBooleanEnv(process.env.DEBUG_RAW_ENABLED),
      defaultModel: process.env.ALIYUN_MODEL || DEFAULT_MODEL
    }
  }
})
