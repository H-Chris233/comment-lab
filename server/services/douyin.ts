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

const ALLOWED_DOUYIN_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com'])

function isAllowedDouyinHost(hostname: string) {
  if (ALLOWED_DOUYIN_HOSTS.has(hostname)) return true
  return hostname.endsWith('.douyin.com') || hostname.endsWith('.iesdouyin.com')
}

export function extractDouyinVideoId(url: string) {
  const match = url.match(/\/(?:video|share\/video)\/(\d{8,24})(?:[/?#]|$)/)
  return match?.[1] || null
}

export function toCanonicalDouyinVideoUrl(videoId: string) {
  return `https://www.douyin.com/video/${videoId}`
}

async function resolveShortDouyinUrl(url: string) {
  let current = url

  for (let i = 0; i < 5; i += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)

    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; CommentLab/1.0)'
        }
      })

      const location = res.headers.get('location')
      if (!location || res.status < 300 || res.status >= 400) {
        return current
      }

      current = new URL(location, current).toString()
    } finally {
      clearTimeout(timer)
    }
  }

  return current
}

export async function normalizeDouyinVideoUrl(inputUrl: string, requestId?: string) {
  const validated = validateUrl(inputUrl)
  const parsed = new URL(validated)

  if (!isAllowedDouyinHost(parsed.hostname)) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '仅支持 douyin.com / v.douyin.com 链接',
      statusCode: 400
    })
  }

  const directId = extractDouyinVideoId(validated)
  if (directId) {
    return toCanonicalDouyinVideoUrl(directId)
  }

  try {
    const resolved = await resolveShortDouyinUrl(validated)
    const resolvedId = extractDouyinVideoId(resolved)

    if (resolvedId) {
      return toCanonicalDouyinVideoUrl(resolvedId)
    }
  } catch (error) {
    console.warn('[douyin.normalize] resolve failed', {
      requestId,
      host: parsed.hostname,
      message: error instanceof Error ? error.message : 'unknown'
    })
  }

  throw createAppError({
    code: 'PARSE_LINK_FAILED',
    message: '链接解析失败，请改为上传视频',
    statusCode: 422
  })
}

export async function parseDouyinLink(url: string, requestId?: string): Promise<ParsedVideoResult> {
  const canonical = await normalizeDouyinVideoUrl(url, requestId)

  console.info('[douyin.parse]', {
    requestId,
    host: new URL(canonical).hostname,
    engine: 'douyin-link-normalizer'
  })

  return {
    ok: true,
    videoUrl: canonical,
    title: undefined,
    cover: undefined,
    raw: undefined
  }
}

export async function verifyVideoUrlReachable(_videoUrl: string) {
  return true
}
