import { createRequestId, success } from '../../utils/response'
import { getAuthStatus } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()
  const status = await getAuthStatus(event)
  return success(status, requestId)
})

