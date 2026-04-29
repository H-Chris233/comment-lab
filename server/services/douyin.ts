import { createAppError } from '../utils/errors'
import { validateUrl } from '../utils/validators'
import { readLocalSettings } from './local-settings'

export interface ParsedVideoResult {
  ok: boolean
  videoUrl?: string
  title?: string
  cover?: string
  awemeId?: string
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

function extractAwemeIdFromTikHub(payload: any) {
  const candidates = [
    'data.aweme_detail.aweme_id',
    'data.aweme_detail.awemeId',
    'data.aweme_detail.aweme_id_str',
    'data.aweme_detail.awemeIdStr',
    'data.aweme_id',
    'data.awemeId',
    'aweme_id',
    'awemeId'
  ]

  for (const path of candidates) {
    const value = getByPath(payload, path)
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return undefined
}

function extractCoverFromTikHub(payload: any) {
  return pickFirstUrl(
    getByPath(payload, 'data.aweme_detail.video.cover.url_list')
    ?? getByPath(payload, 'data.aweme_detail.video.origin_cover.url_list')
    ?? getByPath(payload, 'data.cover')
  )
}

type TikHubVideoCandidate = {
  url: string
  bitRate?: number
  source: string
}

function normalizeCandidateUrls(value: unknown): string[] {
  if (typeof value === 'string') return isHttpUrl(value) ? [value] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => normalizeCandidateUrls(item))
}

function parseCandidateBitRate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function collectTikHubVideoCandidates(payload: any) {
  const candidates: TikHubVideoCandidate[] = []
  const bitRatePaths = [
    'data.aweme_detail.video.bit_rate',
    'data.video.bit_rate',
    'aweme_detail.video.bit_rate',
    'video.bit_rate'
  ]

  for (const path of bitRatePaths) {
    const items = getByPath(payload, path)
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const urlList = normalizeCandidateUrls((item as any)?.play_addr?.url_list)
      const bitRate = parseCandidateBitRate((item as any)?.bit_rate ?? (item as any)?.bitrate)
      for (const url of urlList) {
        candidates.push({
          url,
          bitRate,
          source: `${path}:bit_rate`
        })
      }
    }
  }

  const fallbackPaths = [
    { path: 'data.video_url', source: 'data.video_url' },
    { path: 'data.nwm_video_url', source: 'data.nwm_video_url' },
    { path: 'data.aweme_detail.video.play_addr.url_list', source: 'data.aweme_detail.video.play_addr.url_list' },
    { path: 'data.aweme_detail.video.bit_rate[0].play_addr.url_list', source: 'data.aweme_detail.video.bit_rate[0].play_addr.url_list' },
    { path: 'data.aweme_detail.video.play_addr_h264.url_list', source: 'data.aweme_detail.video.play_addr_h264.url_list' },
    { path: 'video_url', source: 'video_url' },
    { path: 'nwm_video_url', source: 'nwm_video_url' }
  ]

  for (const { path, source } of fallbackPaths) {
    const urls = normalizeCandidateUrls(getByPath(payload, path))
    for (const url of urls) {
      candidates.push({ url, source })
    }
  }

  return candidates
}

function extractLowestQualityVideoUrlFromTikHub(payload: any) {
  const candidates = collectTikHubVideoCandidates(payload).filter((candidate) => candidate.bitRate != null)
  if (!candidates.length) return undefined

  candidates.sort((left, right) => (left.bitRate || 0) - (right.bitRate || 0))
  return candidates[0]?.url
}

async function callTikHubForDouyinVideo(shareUrl: string, requestId?: string) {
  const { baseUrl, apiKey: runtimeApiKey } = getTikHubConfig()
  const local = await readLocalSettings()
  const apiKey = (local.tikhubApiKey || runtimeApiKey || '').trim()
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
    '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
    '/api/v1/douyin/web/fetch_one_video_by_share_url',
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

      try {
        const res = await fetch(apiUrl.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json'
          }
        })

        if (!res.ok) {
          lastError = `status=${res.status}`
          console.info('[douyin.tikhub] step:non-200', {
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
          awemeId: extractAwemeIdFromTikHub(json) || extractDouyinVideoId(videoUrl) || undefined,
          raw: json
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'request_error'
        console.info('[douyin.tikhub] step:request-error', {
          requestId,
          endpoint,
          queryKey,
          message: lastError
        })
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

async function callTikHubForDouyinHighQualityPlayUrl(params: {
  shareUrl?: string
  awemeId?: string
  region?: string
  requestId?: string
}) {
  const { baseUrl, apiKey } = getTikHubConfig()
  if (!apiKey) return undefined

  const apiUrl = new URL(`${baseUrl}/api/v1/douyin/app/v3/fetch_video_high_quality_play_url`)
  if (params.awemeId) apiUrl.searchParams.set('aweme_id', params.awemeId)
  if (params.shareUrl) apiUrl.searchParams.set('share_url', params.shareUrl)
  if (params.region) apiUrl.searchParams.set('region', params.region)

  console.info('[douyin.tikhub] step:request-high-quality', {
    requestId: params.requestId,
    region: params.region || null,
    hasAwemeId: Boolean(params.awemeId),
    hasShareUrl: Boolean(params.shareUrl)
  })

  const res = await fetch(apiUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  })

  if (!res.ok) return undefined

  const json = await res.json().catch(() => null)
  if (!json || typeof json !== 'object') return undefined

  const url = getByPath(json, 'data.original_video_url')
    ?? getByPath(json, 'original_video_url')
    ?? getByPath(json, 'data.video_data.original_video_url')

  return typeof url === 'string' && isHttpUrl(url) ? url : undefined
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
    awemeId: resolved.awemeId,
    raw: resolved.raw
  }
}

export async function resolveDouyinDownloadVideoUrl(
  parsed: ParsedVideoResult,
  sourceUrl: string,
  requestId?: string,
  options?: { region?: string }
): Promise<string> {
  if (options?.region === 'CN') {
    // CN 这里优先尝试 TikHub 返回的高质量播放地址；
    // 如果上游没有高质量结果，再退回到本地解析到的低码率候选。
    const awemeId = parsed.awemeId || extractDouyinVideoId(parsed.videoUrl || '') || extractDouyinVideoId(sourceUrl)
    if (awemeId) {
      const regionalUrl = await callTikHubForDouyinHighQualityPlayUrl({
        awemeId,
        shareUrl: sourceUrl,
        region: options.region,
        requestId
      })

      if (regionalUrl) {
        console.info('[douyin.download] selected-regional-url', {
          requestId,
          region: options.region,
          host: new URL(regionalUrl).hostname
        })
        return regionalUrl
      }
    }

    const lowestQualityUrl = extractLowestQualityVideoUrlFromTikHub(parsed.raw)
    if (lowestQualityUrl) {
      console.info('[douyin.download] selected-lowest-quality-url', {
        requestId,
        host: new URL(lowestQualityUrl).hostname
      })
      return lowestQualityUrl
    }
  }

  const awemeId = parsed.awemeId || extractDouyinVideoId(parsed.videoUrl || '') || extractDouyinVideoId(sourceUrl)
  if (options?.region && awemeId) {
    const regionalUrl = await callTikHubForDouyinHighQualityPlayUrl({
      awemeId,
      shareUrl: sourceUrl,
      region: options.region,
      requestId
    })

    if (regionalUrl) {
      console.info('[douyin.download] selected-regional-url', {
        requestId,
        region: options.region,
        host: new URL(regionalUrl).hostname
      })
      return regionalUrl
    }
  }

  const fallbackVideoUrl = parsed.videoUrl || sourceUrl
  console.info('[douyin.download] fallback-to-parsed-url', {
    requestId,
    host: new URL(fallbackVideoUrl).hostname
  })
  return fallbackVideoUrl
}

export async function resolveDouyinLowQualityDownloadVideoUrl(
  parsed: ParsedVideoResult,
  sourceUrl: string,
  requestId?: string
): Promise<string> {
  const lowestQualityUrl = extractLowestQualityVideoUrlFromTikHub(parsed.raw)
  if (lowestQualityUrl) {
    console.info('[douyin.download] selected-lowest-quality-url', {
      requestId,
      host: new URL(lowestQualityUrl).hostname
    })
    return lowestQualityUrl
  }

  const fallbackVideoUrl = parsed.videoUrl || sourceUrl
  console.info('[douyin.download] fallback-to-parsed-url', {
    requestId,
    host: new URL(fallbackVideoUrl).hostname
  })
  return fallbackVideoUrl
}

export async function verifyVideoUrlReachable(_videoUrl: string) {
  return true
}
