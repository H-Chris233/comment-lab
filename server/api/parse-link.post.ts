import { parseDouyinLink } from '../services/douyin'
import { toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { validateUrl } from '../utils/validators'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()

  try {
    console.info('[api.parse-link] start', { requestId })
    const body = await readBody<{ url?: string }>(event)
    console.info('[api.parse-link] step:read-body', {
      requestId,
      hasUrl: Boolean(body?.url),
      rawUrlLength: body?.url?.length || 0
    })
    const url = validateUrl(body?.url)
    console.info('[api.parse-link] step:validated-url', {
      requestId,
      host: new URL(url).hostname
    })

    const parsed = await parseDouyinLink(url, requestId)
    console.info('[api.parse-link] success', {
      requestId,
      videoHost: parsed.videoUrl ? new URL(parsed.videoUrl).hostname : '',
      hasTitle: Boolean(parsed.title),
      hasCover: Boolean(parsed.cover)
    })

    return success({
      videoUrl: parsed.videoUrl!,
      title: parsed.title,
      cover: parsed.cover
    }, requestId)
  } catch (error) {
    console.error('[api.parse-link] failed', {
      requestId,
      message: error instanceof Error ? error.message : 'unknown',
      code: typeof (error as any)?.code === 'string' ? (error as any).code : undefined,
      stack: error instanceof Error ? error.stack : undefined
    })

    const mapped = toApiError(error, requestId, {
      code: 'PARSE_LINK_FAILED',
      message: '链接解析失败，请改为上传视频',
      statusCode: 422
    })
    setResponseStatus(event, mapped.statusCode)
    return failure(mapped)
  }
})
