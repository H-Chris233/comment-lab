import { createRequestId, success } from '../../utils/response'
import { logout } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()
  const data = await logout(event)
  return success(data, requestId)
})

