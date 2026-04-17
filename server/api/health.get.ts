import { createRequestId, success } from '../utils/response'

export default defineEventHandler(() => {
  const requestId = createRequestId()
  return success({ ok: true }, requestId)
})
