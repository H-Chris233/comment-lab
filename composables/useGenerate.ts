import { ref } from 'vue'
import type { ApiError, GenerateRequestPayload, GenerateResponse, ParseLinkResponse } from '~/types/api'

type StreamEvent = {
  event: string
  data: any
}

type ShuffleBucket = 'short' | 'medium' | 'long'

const EMOJI_SEQUENCE_RE = /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*|[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2})/gu
const LENGTH_IGNORE_RE = /[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]/g
const MAX_CONSECUTIVE_BUCKET = 3
const SHUFFLE_BUCKETS: ShuffleBucket[] = ['short', 'medium', 'long']

function countVisibleLengthWithoutEmojiAndPunctuation(line: string) {
  return line.replace(EMOJI_SEQUENCE_RE, '').replace(LENGTH_IGNORE_RE, '').length
}

function getShuffleBucket(text: string) {
  const length = countVisibleLengthWithoutEmojiAndPunctuation(text)
  if (length <= 10) return 'short'
  if (length <= 18) return 'medium'
  return 'long'
}

const LEADING_DECORATOR_RE = /^[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]+/u

function stripLeadingDecorators(text: string) {
  let value = text.trim()

  while (true) {
    const before = value
    const punctuation = value.match(LEADING_DECORATOR_RE)
    if (punctuation) {
      value = value.slice(punctuation[0].length)
    }

    const emoji = value.match(EMOJI_SEQUENCE_RE)?.[0]
    if (emoji && value.startsWith(emoji)) {
      value = value.slice(emoji.length)
    }

    if (value === before) break
  }

  return value
}

function getOpeningKey(text: string) {
  return Array.from(stripLeadingDecorators(text)).slice(0, 2).join('')
}

function randomizeArrayInPlace<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

function hasAlternativeOpeningKey<T extends string>(items: T[], lastOpeningKey: string | null) {
  if (!lastOpeningKey) return false
  return items.some((item) => getOpeningKey(item) !== lastOpeningKey)
}

function takePreferredItem<T extends string>(items: T[], lastOpeningKey: string | null) {
  if (!items.length) return null
  if (!lastOpeningKey) {
    return items.shift() ?? null
  }

  const preferredIndex = items.findIndex((item) => getOpeningKey(item) !== lastOpeningKey)
  if (preferredIndex === -1) {
    return items.shift() ?? null
  }

  return items.splice(preferredIndex, 1)[0] ?? null
}

function pickWeightedBucket<T extends string>(
  buckets: Record<ShuffleBucket, T[]>,
  candidates: ShuffleBucket[],
  lastBucket: ShuffleBucket | null,
  runLength: number
) : ShuffleBucket | null {
  const scored = candidates
    .map((bucket) => {
      const remaining = buckets[bucket].length
      if (!remaining) return null

      let weight = remaining
      if (bucket === lastBucket) {
        if (runLength >= MAX_CONSECUTIVE_BUCKET) {
          weight = 0
        } else {
          weight *= Math.max(0.2, 1 - runLength * 0.25)
        }
      }

      return { bucket, weight }
    })
    .filter((item): item is { bucket: ShuffleBucket; weight: number } => item !== null && item.weight > 0)

  if (!scored.length) return null

  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0)
  const roll = Math.random() * totalWeight

  let acc = 0
  for (const item of scored) {
    acc += item.weight
    if (roll < acc) return item.bucket
  }

  return scored[scored.length - 1].bucket
}

export function shuffleInPlace<T extends string>(items: T[], cycleIndex = 0) {
  void cycleIndex
  const randomizedItems = randomizeArrayInPlace(items.slice())
  const buckets: Record<ShuffleBucket, T[]> = {
    short: [],
    medium: [],
    long: []
  }

  for (const item of randomizedItems) {
    buckets[getShuffleBucket(item)].push(item)
  }

  const ordered: T[] = []
  let lastBucket: ShuffleBucket | null = null
  let runLength = 0
  let lastOpeningKey: string | null = null

  while (buckets.short.length || buckets.medium.length || buckets.long.length) {
    const available: ShuffleBucket[] = SHUFFLE_BUCKETS.filter((bucket) => buckets[bucket].length > 0)
    if (!available.length) break

    const openingFriendly = available.filter((bucket) => hasAlternativeOpeningKey(buckets[bucket], lastOpeningKey))
    const prefixedAvailable = openingFriendly.length ? openingFriendly : available
    const candidates: ShuffleBucket[] = lastBucket && runLength >= MAX_CONSECUTIVE_BUCKET && prefixedAvailable.length > 1
      ? prefixedAvailable.filter((bucket) => bucket !== lastBucket)
      : prefixedAvailable

    const nextBucket: ShuffleBucket | null = pickWeightedBucket(buckets, candidates.length ? candidates : available, lastBucket, runLength)
    if (!nextBucket) break

    const nextItem = takePreferredItem(buckets[nextBucket], lastOpeningKey)
    if (nextItem == null) continue

    ordered.push(nextItem)
    lastOpeningKey = getOpeningKey(nextItem)
    if (nextBucket === lastBucket) {
      runLength += 1
    } else {
      lastBucket = nextBucket
      runLength = 1
    }
  }

  items.splice(0, items.length, ...ordered)

  return items
}

function parseSseEvents(chunk: string): StreamEvent[] {
  const events: StreamEvent[] = []
  const blocks = chunk.replace(/\r/g, '').split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n')
    let event = 'message'
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    if (!dataLines.length) continue
    const raw = dataLines.join('\n')

    try {
      events.push({ event, data: JSON.parse(raw) })
    } catch (error) {
      if (import.meta.dev) {
        console.warn('[useGenerate] failed to parse SSE event payload', {
          event,
          rawPreview: raw.slice(0, 200),
          message: error instanceof Error ? error.message : 'unknown'
        })
      }
    }
  }

  return events
}

export function useGenerate() {
  const parsing = ref(false)
  const generating = ref(false)
  const error = ref('')
  const errorCode = ref('')

  const comments = ref<string[]>([])
  const rawText = ref('')
  const rawPromptTrace = ref<string[]>([])
  const requestId = ref('')
  const requestedCount = ref(0)
  const finalCount = ref(0)
  const beforeNormalizeCount = ref(0)
  const afterNormalizeCount = ref(0)
  const model = ref('')
  const abortController = ref<AbortController | null>(null)
  const requestTimeoutId = ref<ReturnType<typeof setTimeout> | null>(null)
  let streamedCommentSet = new Set<string>()
  let requestTimedOut = false
  const runtimeConfig = useRuntimeConfig()

  const lastPayload = ref<GenerateRequestPayload & { file?: File | null } | null>(null)

  function toApiErrorLike(error: unknown): ApiError {
    const fallback: ApiError = {
      ok: false,
      code: 'NETWORK_ERROR',
      message: '请求失败，请检查网络后重试',
      requestId: requestId.value
    }

    if (!error || typeof error !== 'object') return fallback

    const e = error as {
      data?: Partial<ApiError>
      response?: { _data?: Partial<ApiError> }
      status?: number
      statusCode?: number
      message?: string
    }

    const payload = e.data || e.response?._data
    if (payload?.ok === false && payload.code && payload.message) {
      return {
        ok: false,
        code: payload.code,
        message: payload.message,
        requestId: payload.requestId || requestId.value,
        data: payload.data
      }
    }

    const status = e.statusCode || e.status
    if (status === 504 || status === 524) {
      return {
        ok: false,
        code: 'REQUEST_TIMEOUT',
        message: '请求超时（后端可能仍在处理中），请稍后重试并减少生成数量',
        requestId: requestId.value
      }
    }

    const msg = e.message || ''
    if (/aborted|timeout|timed out|fetch failed|network/i.test(msg)) {
      return {
        ok: false,
        code: 'REQUEST_TIMEOUT',
        message: '请求超时或网络中断，请重试',
        requestId: requestId.value
      }
    }

    return {
      ok: false,
      code: fallback.code,
      message: fallback.message,
      requestId: requestId.value
    }
  }

  async function parseLink(url: string): Promise<ParseLinkResponse> {
    parsing.value = true
    try {
      return await $fetch<ParseLinkResponse>('/api/parse-link', {
        method: 'POST',
        body: { url }
      })
    } catch (e) {
      const mapped = toApiErrorLike(e)
      return {
        ok: false,
        code: mapped.code || 'PARSE_LINK_FAILED',
        message: mapped.message || '链接解析失败，请稍后重试',
        requestId: mapped.requestId || ''
      }
    } finally {
      parsing.value = false
    }
  }

  async function generate(payload: GenerateRequestPayload & { file?: File | null }): Promise<GenerateResponse | ApiError> {
    if (generating.value) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: '正在生成中，请稍候',
        requestId: requestId.value
      }
    }

    generating.value = true
    error.value = ''
    errorCode.value = ''
    comments.value = []
    rawText.value = ''
    rawPromptTrace.value = []
    requestedCount.value = payload.count
    beforeNormalizeCount.value = 0
    afterNormalizeCount.value = 0
    finalCount.value = 0
    streamedCommentSet = new Set<string>()
    requestTimedOut = false

    try {
      abortController.value = new AbortController()
      const timeoutMs = Number(runtimeConfig.public?.generateTimeoutMs || runtimeConfig.generateTimeoutMs || 3_600_000)
      requestTimeoutId.value = setTimeout(() => {
        requestTimedOut = true
        abortController.value?.abort()
      }, timeoutMs)
      const form = new FormData()
      form.append('mode', payload.mode)
      if (payload.inputMode) form.append('inputMode', payload.inputMode)
      if (payload.model) form.append('model', payload.model)
      if (payload.includeCommentSamples != null) form.append('includeCommentSamples', String(payload.includeCommentSamples))
      if (payload.url) form.append('url', payload.url)
      if (payload.file) form.append('video', payload.file)
      form.append('count', String(payload.count))
      form.append('basePrompt', payload.basePrompt)
      form.append('dedupe', String(payload.dedupe ?? true))
      form.append('cleanEmpty', String(payload.cleanEmpty ?? true))

      const response = await fetch('/api/generate?stream=1', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream'
        },
        body: form,
        signal: abortController.value.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        if (errorData && typeof errorData === 'object' && errorData.ok === false) {
          const apiError = errorData as ApiError
          error.value = apiError.message
          errorCode.value = apiError.code
          return apiError
        }

        throw new Error(`HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('stream body is empty')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let doneResponse: GenerateResponse | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const boundary = buffer.lastIndexOf('\n\n')
        if (boundary === -1) continue

        const completed = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const events = parseSseEvents(completed)

        for (const evt of events) {
          if (evt.event === 'meta') {
            requestId.value = evt.data?.requestId || requestId.value
            requestedCount.value = Number(evt.data?.requestedCount || 0)
            model.value = evt.data?.model || model.value
          }

          if (evt.event === 'item') {
            const comment = typeof evt.data?.comment === 'string' ? evt.data.comment.trim() : ''
            if (comment && !streamedCommentSet.has(comment) && (!requestedCount.value || comments.value.length < requestedCount.value)) {
              streamedCommentSet.add(comment)
              comments.value.push(comment)
              finalCount.value = comments.value.length
            }
          }

          if (evt.event === 'partial') {
            if (!comments.value.length && Array.isArray(evt.data?.comments)) {
              comments.value = evt.data.comments
              streamedCommentSet = new Set(comments.value.map((comment) => comment.trim()).filter(Boolean))
            }
            if (typeof evt.data?.rawText === 'string') rawText.value = evt.data.rawText
            if (Array.isArray(evt.data?.promptTrace)) rawPromptTrace.value = evt.data.promptTrace
            beforeNormalizeCount.value = Number(evt.data?.beforeNormalizeCount || 0)
            afterNormalizeCount.value = Number(evt.data?.afterNormalizeCount || comments.value.length)
            finalCount.value = Number(evt.data?.finalCount || comments.value.length)
          }

          if (evt.event === 'done') {
            doneResponse = evt.data as GenerateResponse
          }

          if (evt.event === 'error') {
            doneResponse = evt.data as ApiError
          }
        }
      }

      // flush trailing fragment
      if (buffer.trim()) {
        const events = parseSseEvents(buffer)
        for (const evt of events) {
          if (evt.event === 'done' || evt.event === 'error') {
            doneResponse = evt.data as GenerateResponse
          }
        }
      }

      if (!doneResponse) {
        throw new Error('流式响应未返回完成事件')
      }

      requestId.value = doneResponse.requestId || requestId.value

      if (!doneResponse.ok) {
        error.value = doneResponse.message
        errorCode.value = doneResponse.code
        if (doneResponse.data?.rawText && typeof doneResponse.data.rawText === 'string') rawText.value = doneResponse.data.rawText
        if (Array.isArray(doneResponse.data?.promptTrace)) rawPromptTrace.value = doneResponse.data.promptTrace
        return doneResponse
      }

      comments.value = doneResponse.data.comments
      streamedCommentSet = new Set(comments.value.map((comment) => comment.trim()).filter(Boolean))
      rawText.value = doneResponse.data.rawText
      rawPromptTrace.value = doneResponse.data.promptTrace
      requestedCount.value = doneResponse.data.requestedCount
      finalCount.value = doneResponse.data.finalCount
      beforeNormalizeCount.value = doneResponse.data.beforeNormalizeCount
      afterNormalizeCount.value = doneResponse.data.afterNormalizeCount
      model.value = doneResponse.data.model
      lastPayload.value = payload

      return doneResponse
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        if (requestTimedOut) {
          error.value = '请求超时，请重试'
          errorCode.value = 'REQUEST_TIMEOUT'
        } else {
          error.value = '已取消本次生成'
          errorCode.value = 'REQUEST_ABORTED'
        }
        return {
          ok: false,
          code: errorCode.value,
          message: error.value,
          requestId: requestId.value
        }
      }

      const mapped = toApiErrorLike(e)
      error.value = mapped.message
      errorCode.value = mapped.code
      comments.value = []
      rawText.value = ''
      rawPromptTrace.value = []
      return {
        ok: false,
        code: errorCode.value,
        message: error.value,
        requestId: mapped.requestId || requestId.value
      }
    } finally {
      if (requestTimeoutId.value != null) {
        clearTimeout(requestTimeoutId.value)
        requestTimeoutId.value = null
      }
      abortController.value = null
      generating.value = false
    }
  }

  function cancelGenerate() {
    if (!abortController.value) return
    abortController.value.abort()
  }

  function shuffleComments() {
    shuffleInPlace(comments.value)
  }

  async function regenerate() {
    if (!lastPayload.value) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: '暂无可复用的生成参数',
        requestId: requestId.value
      } as ApiError
    }

    return generate(lastPayload.value)
  }

  return {
    parsing,
    generating,
    error,
    errorCode,
    comments,
    rawText,
    rawPromptTrace,
    requestId,
    requestedCount,
    finalCount,
    beforeNormalizeCount,
    afterNormalizeCount,
    model,
    parseLink,
    generate,
    regenerate,
    cancelGenerate,
    shuffleComments
  }
}
