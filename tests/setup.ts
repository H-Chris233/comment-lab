import { defineEventHandler, readBody, readMultipartFormData, setResponseStatus } from 'h3'

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
    maxVideoSizeMb: 100,
    tempVideoRetentionMinutes: 10,
    pythonDashscopeServiceUrl: 'http://127.0.0.1:8001'
  })
})
