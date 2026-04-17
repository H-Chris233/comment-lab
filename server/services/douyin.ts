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

function isAllowedDouyinHost(hostname: string) {
  if (ALLOWED_DOUYIN_HOSTS.has(hostname)) return true
  return hostname.endsWith('.douyin.com')
}

export async function parseDouyinLink(url: string, requestId?: string): Promise<ParsedVideoResult> {
  const safeUrl = validateUrl(url)
  const parsed = new URL(safeUrl)

  if (!isAllowedDouyinHost(parsed.hostname)) {
    throw createAppError({
      code: 'PARSE_LINK_FAILED',
      message: '仅支持 douyin.com / v.douyin.com 链接',
      statusCode: 422
    })
  }

  console.info('[douyin.parse]', {
    requestId,
    host: parsed.hostname,
    engine: 'douyin-downloader-parser'
  })

  return {
    ok: true,
    videoUrl: safeUrl,
    title: undefined,
    cover: undefined,
    raw: undefined
  }
}

export async function verifyVideoUrlReachable(_videoUrl: string) {
  return true
}
