import { parseDouyinLink } from '../services/douyin'
import { toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { validateUrl } from '../utils/validators'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()

  try {
    const body = await readBody<{ url?: string }>(event)
    const url = validateUrl(body?.url)

    const parsed = await parseDouyinLink(url, requestId)

    return success({
      videoUrl: parsed.videoUrl!,
      title: parsed.title,
      cover: parsed.cover
    }, requestId)
  } catch (error) {
    const mapped = toApiError(error, requestId, {
      code: 'PARSE_LINK_FAILED',
      message: '链接解析失败，请改为上传视频',
      statusCode: 422
    })
    setResponseStatus(event, mapped.statusCode)
    return failure(mapped)
  }
})
