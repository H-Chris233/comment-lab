import { readBody, setResponseStatus } from 'h3'
import { createRequestId, failure, success } from '../../utils/response'
import { toApiError } from '../../utils/errors'
import { changePassword, validatePasswordValue } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()

  try {
    const body = await readBody<{ password?: string; confirmPassword?: string }>(event)
    const password = validatePasswordValue(body?.password)
    const data = await changePassword(event, password, body?.confirmPassword)
    return success(data, requestId)
  } catch (error) {
    const mapped = toApiError(error, requestId, {
      code: 'AUTH_FAILED',
      message: '修改密码失败，请重试',
      statusCode: 400
    })
    setResponseStatus(event, mapped.statusCode)
    return failure(mapped)
  }
})

