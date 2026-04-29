import { defineEventHandler } from 'h3'
import { readLocalSettings } from '../services/local-settings'
import { createRequestId, success } from '../utils/response'

export default defineEventHandler(async () => {
  const requestId = createRequestId()
  const data = await readLocalSettings()
  return success(data, requestId)
})
