import { YtDlp } from 'ytdlp-nodejs'
import { createAppError } from '../utils/errors'
import { validateUrl } from '../utils/validators'

export interface ParsedVideoResult {
  ok: boolean
  videoUrl?: string
  title?: string
  cover?: string
  raw?: unknown
  message?: string
}

const ALLOWED_DOUYIN_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com'])

function assertDouyinHost(url: string) {
  const parsed = new URL(validateUrl(url))
  if (ALLOWED_DOUYIN_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.douyin.com')) {
    return parsed.toString()
  }

  throw createAppError({
    code: 'INVALID_INPUT',
    message: '仅支持 douyin.com / v.douyin.com 链接',
    statusCode: 400
  })
}

export async function parseDouyinLink(url: string, requestId?: string): Promise<ParsedVideoResult> {
  const safeUrl = assertDouyinHost(url)
  const ytdlp = new YtDlp()

  try {
    const info = await ytdlp.getInfoAsync(safeUrl)

    return {
      ok: true,
      videoUrl: safeUrl,
      title: (info as any)?.title,
      cover: (info as any)?.thumbnail,
      raw: undefined
    }
  } catch (error) {
    console.error('[douyin.parse] failed', {
      requestId,
      host: new URL(safeUrl).hostname,
      message: error instanceof Error ? error.message : 'unknown'
    })

    throw createAppError({
      code: 'PARSE_LINK_FAILED',
      message: '链接解析失败，请改为上传视频',
      statusCode: 422
    })
  }
}

export async function verifyVideoUrlReachable(_videoUrl: string) {
  return true
}
