import { parseBooleanEnv } from './utils/env'

export default defineNuxtConfig({
  compatibilityDate: '2025-10-10',
  devtools: { enabled: true },
  runtimeConfig: {
    aliyunApiKey: process.env.ALIYUN_API_KEY,
    aliyunBaseUrl: process.env.ALIYUN_BASE_URL,
    aliyunModel: process.env.ALIYUN_MODEL,
    douyinApiBase: process.env.DOUYIN_API_BASE,
    maxVideoSizeMb: Number(process.env.MAX_VIDEO_SIZE_MB || 100),
    tempVideoDir: process.env.TEMP_VIDEO_DIR,
    public: {
      appName: 'Comment Lab',
      debugRawEnabled: parseBooleanEnv(process.env.DEBUG_RAW_ENABLED)
    }
  }
})
