import { createAppError } from '../utils/errors'
import { isHttpUrl, validateUrl } from '../utils/validators'

export interface ParsedVideoResult {
  ok: boolean
  videoUrl?: string
  title?: string
  cover?: string
  raw?: unknown
  message?: string
}

function normalizeDouyinUrl(url: string) {
  return url.trim()
}

function mapThirdPartyResponse(raw: any): ParsedVideoResult {
  const videoUrl = raw?.videoUrl || raw?.data?.videoUrl || raw?.data?.url || raw?.url
  const title = raw?.title || raw?.data?.title
  const cover = raw?.cover || raw?.data?.cover
  const ok = Boolean(raw?.ok ?? videoUrl)
  const message = raw?.message || raw?.msg

  return {
    ok,
    videoUrl,
    title,
    cover,
    raw,
    message
  }
}

export async function parseDouyinLink(url: string, requestId?: string): Promise<ParsedVideoResult> {
  const config = useRuntimeConfig()
  if (!config.douyinApiBase) {
    throw createAppError({ code: 'PARSE_LINK_FAILED', message: '未配置 DOUYIN_API_BASE', statusCode: 500, expose: false })
  }

  const normalized = normalizeDouyinUrl(validateUrl(url))

  let raw: unknown
  try {
    raw = await $fetch(`${config.douyinApiBase}/parse`, {
      method: 'POST',
      body: { url: normalized },
      timeout: 10_000
    })
  } catch (error) {
    console.error('[douyin.parse] request failed', {
      requestId,
      message: error instanceof Error ? error.message : 'unknown'
    })
    throw createAppError({ code: 'PARSE_LINK_FAILED', message: '链接解析失败，请改为上传视频', statusCode: 422 })
  }

  const mapped = mapThirdPartyResponse(raw)

  if (!mapped.videoUrl) {
    console.warn('[douyin.parse] missing videoUrl', {
      requestId,
      ok: mapped.ok,
      message: mapped.message,
      rawType: typeof mapped.raw
    })
    throw createAppError({ code: 'PARSE_LINK_FAILED', message: '链接解析失败，请改为上传视频', statusCode: 422 })
  }

  if (!isHttpUrl(mapped.videoUrl)) {
    console.warn('[douyin.parse] invalid videoUrl', {
      requestId,
      urlPreview: String(mapped.videoUrl).slice(0, 80)
    })
    throw createAppError({ code: 'PARSE_LINK_FAILED', message: '链接解析失败，请改为上传视频', statusCode: 422 })
  }

  return mapped
}

export async function verifyVideoUrlReachable(videoUrl: string, requestId?: string) {
  try {
    const res = await fetch(videoUrl, { method: 'HEAD' })
    if (!res.ok) {
      throw new Error(`HEAD ${res.status}`)
    }
    return true
  } catch (headError) {
    try {
      const res = await fetch(videoUrl, { method: 'GET', headers: { Range: 'bytes=0-0' } })
      if (!res.ok) {
        throw new Error(`GET ${res.status}`)
      }
      return true
    } catch (error) {
      console.error('[douyin.verifyVideoUrlReachable] failed', {
        requestId,
        message: error instanceof Error ? error.message : 'unknown',
        headError: headError instanceof Error ? headError.message : 'unknown'
      })
      throw createAppError({ code: 'VIDEO_FETCH_FAILED', message: '视频地址不可访问，请改为上传视频', statusCode: 422 })
    }
  }
}
