import { defineEventHandler, readBody } from 'h3'
import { writeLocalSettings } from '../services/local-settings'
import { createRequestId, success } from '../utils/response'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()
  const body = await readBody<{
    aliyunApiKey?: string
    aliyunBaseUrl?: string
    tikhubApiKey?: string
    pythonServiceUrl?: string
    aliyunModel?: string
    debugRawEnabled?: boolean
  }>(event)
  const data = await writeLocalSettings(body || {})
  return success(data, requestId)
})
