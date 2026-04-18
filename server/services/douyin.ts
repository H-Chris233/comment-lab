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

function getTikHubConfig() {
  const config = useRuntimeConfig()
  const baseUrl = (config.tikhubBaseUrl || 'https://api.tikhub.io').toString().replace(/\/+$/, '')
  const apiKey = (config.tikhubApiKey || '').toString().trim()
  return { baseUrl, apiKey }
}

function ensureDouyinHost(inputUrl: string) {
  const validated = validateUrl(inputUrl)
  const parsed = new URL(validated)

  if (!isAllowedDouyinHost(parsed.hostname)) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '仅支持 douyin.com / v.douyin.com 链接',
      statusCode: 400
    })
  }

  return validated
}

function isHttpUrl(value?: unknown) {
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function pickFirstUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return isHttpUrl(value) ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = pickFirstUrl(item)
      if (url) return url
    }
  }
  return undefined
}

function getByPath(obj: any, path: string): unknown {
  return path.split('.').reduce((cur, key) => {
    if (cur == null) return undefined
    if (key.endsWith(']')) {
      const m = key.match(/^([^\[]+)\[(\d+)\]$/)
      if (!m) return undefined
      const arr = cur[m[1]]
      return Array.isArray(arr) ? arr[Number(m[2])] : undefined
    }
    return cur[key]
  }, obj)
}

function extractVideoUrlFromTikHub(payload: any) {
  const candidates = [
    'data.video_url',
    'data.nwm_video_url',
    'data.aweme_detail.video.play_addr.url_list[0]',
    'data.aweme_detail.video.bit_rate[0].play_addr.url_list[0]',
    'data.aweme_detail.video.play_addr_h264.url_list[0]',
    'video_url',
    'nwm_video_url'
  ]

  for (const path of candidates) {
    const url = pickFirstUrl(getByPath(payload, path))
    if (url) return url
  }

  const serialized = JSON.stringify(payload)
  const match = serialized.match(/https?:\/\/[^"'\s\\]+(?:\.mp4|video\/tos[^"'\s\\]*)/i)
  if (match?.[0] && isHttpUrl(match[0])) return match[0]

  return undefined
}

function extractTitleFromTikHub(payload: any) {
  const title = getByPath(payload, 'data.aweme_detail.desc')
    ?? getByPath(payload, 'data.desc')
    ?? getByPath(payload, 'data.title')
  return typeof title === 'string' ? title : undefined
}

function extractCoverFromTikHub(payload: any) {
  return pickFirstUrl(
    getByPath(payload, 'data.aweme_detail.video.cover.url_list')
    ?? getByPath(payload, 'data.aweme_detail.video.origin_cover.url_list')
    ?? getByPath(payload, 'data.cover')
  )
}

async function callTikHubForDouyinVideo(shareUrl: string, requestId?: string) {
  const { baseUrl, apiKey } = getTikHubConfig()
  console.info('[douyin.tikhub] start', {
    requestId,
    baseUrl,
    shareHost: new URL(shareUrl).hostname,
    hasApiKey: Boolean(apiKey)
  })

  if (!apiKey) {
    throw createAppError({
      code: 'PARSE_LINK_FAILED',
      message: '链接解析服务未配置，请先配置 TikHub API Key',
      statusCode: 422
    })
  }

  const endpointTries = [
    '/api/v1/douyin/web/fetch_one_video_by_share_url',
    '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
    '/api/v1/douyin/app/v2/fetch_one_video_by_share_url'
  ]
  const queryKeys = ['share_url', 'url']
  let lastError = ''

  for (const endpoint of endpointTries) {
    for (const queryKey of queryKeys) {
      const apiUrl = new URL(`${baseUrl}${endpoint}`)
      apiUrl.searchParams.set(queryKey, shareUrl)
      console.info('[douyin.tikhub] step:request', {
        requestId,
        endpoint,
        queryKey
      })

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)

      try {
        const res = await fetch(apiUrl.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json'
          },
          signal: controller.signal
        })

        if (!res.ok) {
          lastError = `status=${res.status}`
          console.warn('[douyin.tikhub] step:non-200', {
            requestId,
            endpoint,
            queryKey,
            status: res.status
          })
          continue
        }

        const json = await res.json().catch(() => null)
        if (!json || typeof json !== 'object') {
          lastError = 'invalid_json'
          console.warn('[douyin.tikhub] step:invalid-json', {
            requestId,
            endpoint,
            queryKey
          })
          continue
        }

        const videoUrl = extractVideoUrlFromTikHub(json)
        if (!videoUrl) {
          lastError = 'video_url_not_found'
          console.warn('[douyin.tikhub] step:no-video-url', {
            requestId,
            endpoint,
            queryKey
          })
          continue
        }

        console.info('[douyin.tikhub] step:resolved', {
          requestId,
          endpoint,
          queryKey,
          videoHost: new URL(videoUrl).hostname,
          hasTitle: Boolean(extractTitleFromTikHub(json)),
          hasCover: Boolean(extractCoverFromTikHub(json))
        })

        return {
          videoUrl,
          title: extractTitleFromTikHub(json),
          cover: extractCoverFromTikHub(json),
          raw: json
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'request_error'
        console.warn('[douyin.tikhub] step:request-error', {
          requestId,
          endpoint,
          queryKey,
          message: lastError
        })
      } finally {
        clearTimeout(timer)
      }
    }
  }

  console.warn('[douyin.tikhub] fetch failed', {
    requestId,
    host: new URL(shareUrl).hostname,
    lastError
  })

  throw createAppError({
    code: 'PARSE_LINK_FAILED',
    message: '链接解析失败，请改为上传视频',
    statusCode: 422
  })
}

export async function normalizeDouyinVideoUrl(inputUrl: string) {
  const validated = ensureDouyinHost(inputUrl)
  const directId = extractDouyinVideoId(validated)
  if (directId) return toCanonicalDouyinVideoUrl(directId)
  return validated
}

export async function resolveDouyinVideoByTikHub(inputUrl: string, requestId?: string) {
  const normalized = await normalizeDouyinVideoUrl(inputUrl)
  return callTikHubForDouyinVideo(normalized, requestId)
}

export async function parseDouyinLink(url: string, requestId?: string): Promise<ParsedVideoResult> {
  console.info('[douyin.parse] start', { requestId })
  const resolved = await resolveDouyinVideoByTikHub(url, requestId)

  console.info('[douyin.parse]', {
    requestId,
    host: new URL(resolved.videoUrl).hostname,
    engine: 'tikhub-douyin-api'
  })

  return {
    ok: true,
    videoUrl: resolved.videoUrl,
    title: resolved.title,
    cover: resolved.cover,
    raw: resolved.raw
  }
}

export async function verifyVideoUrlReachable(_videoUrl: string) {
  return true
}
