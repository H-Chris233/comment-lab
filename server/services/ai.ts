import { createAppError } from '../utils/errors'

const DEFAULT_FPS = 1
const SIDE_CAR_RETRY_DELAYS_MS = [300, 800, 1600]
const SIDE_CAR_RETRY_STATUS_CODES = new Set([502, 503, 504])

type GenerateBaseParams = {
  model: string
  prompt: string
  requestId: string
  fps?: number
  stopAfterItems?: number
  signal?: AbortSignal
  onLine?: (line: string) => void
}

export interface GenerateAiResult {
  rawText: string
  model: string
  usage?: unknown
  finishReason?: string | null
  streamChunkCount: number
  durationMs: number
}

function getPythonServiceBaseUrl() {
  const config = useRuntimeConfig()
  return (config.pythonDashscopeServiceUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '')
}

function buildSidecarPayload(params: {
  model: string
  prompt: string
  fps: number
  inputMode: 'url' | 'file'
  videoUrl?: string
  videoPath?: string
}) {
  return {
    model: params.model,
    prompt: params.prompt,
    fps: params.fps,
    input_mode: params.inputMode,
    video_url: params.videoUrl,
    video_path: params.videoPath
  }
}

function getCompleteLines(raw: string) {
  const lines = raw.split(/\r?\n/)
  if (!/\r?\n$/.test(raw)) {
    lines.pop()
  }
  return lines
}

export function countCompleteItemsByLines(raw: string) {
  return getCompleteLines(raw)
    .map((line) => line.trim())
    .filter(Boolean).length
}

export function createCompleteLineCollector() {
  let processedCompleteLineCount = 0

  return {
    collect(raw: string) {
      const lines = getCompleteLines(raw)
      const newLines = lines.slice(processedCompleteLineCount)
      processedCompleteLineCount = lines.length
      return newLines
        .map((line) => line.trim())
        .filter(Boolean)
    }
  }
}

function takeFirstItems(raw: string, maxItems?: number) {
  if (!maxItems || maxItems <= 0) return raw.trim()

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.slice(0, maxItems).join('\n').trim()
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as any).name === 'AbortError')
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (isAbortError(error)) return false

  const message = error.message.toLowerCase()
  return [
    'fetch failed',
    'networkerror',
    'connection reset',
    'econnreset',
    'etimedout',
    'socket hang up',
    'service unavailable',
    'bad gateway',
    'gateway timeout'
  ].some((needle) => message.includes(needle))
}

function isRetryableSidecarStatus(status: number) {
  return SIDE_CAR_RETRY_STATUS_CODES.has(status)
}

function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function callPythonSidecar(params: {
  model: string
  prompt: string
  fps: number
  inputMode: 'url' | 'file'
  videoUrl?: string
  videoPath?: string
  requestId: string
  signal?: AbortSignal
}) {
  const baseUrl = getPythonServiceBaseUrl()
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': params.requestId
    },
    body: JSON.stringify(buildSidecarPayload({
      ...params
    })),
    signal: params.signal
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as null | {
      detail?: unknown
      message?: unknown
    }
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : typeof payload?.message === 'string'
        ? payload.message
        : `Python sidecar 请求失败（HTTP ${response.status}）`
    throw createAppError({
      code: 'MODEL_CALL_FAILED',
      message: detail,
      statusCode: response.status
    })
  }

  const payload = await response.json().catch(() => null) as null | {
    rawText?: unknown
    model?: unknown
    usage?: unknown
    finishReason?: unknown
  }

  if (!payload) {
    throw createAppError({
      code: 'MODEL_CALL_FAILED',
      message: 'Python sidecar 响应为空',
      statusCode: 502
    })
  }

  return {
    rawText: typeof payload.rawText === 'string' ? payload.rawText : '',
    model: typeof payload.model === 'string' ? payload.model : params.model,
    usage: payload.usage,
    finishReason: typeof payload.finishReason === 'string' ? payload.finishReason : null
  }
}

async function callPythonSidecarWithRetry(params: Parameters<typeof callPythonSidecar>[0]) {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= SIDE_CAR_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await callPythonSidecar(params)
    } catch (error) {
      lastError = error

      if (isAbortError(error)) throw error

      const retryable = error instanceof Error && isRetryableNetworkError(error)
      if (!retryable) {
        const statusCode = (error as any)?.statusCode
        if (!isRetryableSidecarStatus(Number(statusCode))) {
          throw error
        }
      }

      const delayMs = SIDE_CAR_RETRY_DELAYS_MS[attempt]
      if (delayMs == null) break

      console.warn('[ai.generate] sidecar retry', {
        requestId: params.requestId,
        attempt: attempt + 1,
        delayMs,
        reason: error instanceof Error ? error.message : 'unknown'
      })
      await sleepWithAbort(delayMs, params.signal)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : createAppError({
        code: 'MODEL_CALL_FAILED',
        message: '模型调用失败',
        statusCode: 502
      })
}

async function generateStreamed(params: GenerateBaseParams & {
  inputMode: 'url' | 'file'
  videoUrl?: string
  videoPath?: string
}): Promise<GenerateAiResult> {
  const start = Date.now()
  const fps = params.fps ?? DEFAULT_FPS
  console.info('[ai.generate] start', {
    requestId: params.requestId,
    model: params.model,
    fps,
    inputMode: params.inputMode,
    stopAfterItems: params.stopAfterItems,
    promptLength: params.prompt.length
  })

  let rawAccumulated = ''
  let sidecarResult: Awaited<ReturnType<typeof callPythonSidecar>> | null = null
  const lineCollector = createCompleteLineCollector()
  let emittedItemCount = 0

  try {
    sidecarResult = await callPythonSidecarWithRetry({
      model: params.model,
      prompt: params.prompt,
      fps,
      inputMode: params.inputMode,
      videoUrl: params.videoUrl,
      videoPath: params.videoPath,
      requestId: params.requestId,
      signal: params.signal,
    })

    rawAccumulated = sidecarResult.rawText
    const completeLines = lineCollector.collect(`${rawAccumulated}\n`)
    for (const line of completeLines) {
      if (params.stopAfterItems && emittedItemCount >= params.stopAfterItems) break
      params.onLine?.(line)
      emittedItemCount += 1
    }

    console.info('[ai.generate] step:sidecar-ok', {
      requestId: params.requestId,
      completeLineCount: completeLines.length,
      textLength: rawAccumulated.length
    })
  } catch (error) {
    if (isAbortError(error)) {
      const abortReason = params.signal && 'reason' in params.signal ? (params.signal as AbortSignal & { reason?: unknown }).reason : undefined
      const abortReasonText = abortReason instanceof Error
        ? abortReason.message
        : typeof abortReason === 'string'
          ? abortReason
          : ''

      if (/timeout/i.test(abortReasonText)) {
        throw createAppError({
          code: 'REQUEST_TIMEOUT',
          message: '生成请求超时，请重试',
          statusCode: 504
        })
      }

      throw createAppError({
        code: 'CLIENT_ABORTED',
        message: '客户端已取消本次生成',
        statusCode: 499,
        expose: false
      })
    }

    throw createAppError({
      code: 'MODEL_CALL_FAILED',
      message: error instanceof Error ? error.message : '模型调用失败',
      statusCode: 502
    })
  }

  const rawText = takeFirstItems(rawAccumulated, params.stopAfterItems)
  const durationMs = Date.now() - start

  console.info('[ai.generate]', {
    requestId: params.requestId,
    model: params.model,
    mode: 'python-sidecar',
    fps,
    inputMode: params.inputMode,
    rawTextLength: rawText.length,
    durationMs,
    emittedItemCount,
    usage: sidecarResult?.usage,
    finishReason: sidecarResult?.finishReason
  })

  return {
    rawText,
    model: params.model,
    usage: sidecarResult?.usage,
    finishReason: sidecarResult?.finishReason,
    streamChunkCount: Math.max(1, countCompleteItemsByLines(rawText)),
    durationMs
  }
}

export async function generateFromVideoUrl(params: {
  model: string
  prompt: string
  videoUrl: string
  requestId: string
  fps?: number
  stopAfterItems?: number
  onLine?: (line: string) => void
  signal?: AbortSignal
}) {
  return generateStreamed({
    model: params.model,
    prompt: params.prompt,
    videoUrl: params.videoUrl,
    inputMode: 'url',
    requestId: params.requestId,
    fps: params.fps,
    stopAfterItems: params.stopAfterItems,
    onLine: params.onLine,
    signal: params.signal
  })
}

export async function generateFromVideoFile(params: {
  model: string
  prompt: string
  videoPath: string
  requestId: string
  fps?: number
  stopAfterItems?: number
  onLine?: (line: string) => void
  signal?: AbortSignal
}) {
  return generateStreamed({
    model: params.model,
    prompt: params.prompt,
    videoPath: params.videoPath,
    inputMode: 'file',
    requestId: params.requestId,
    fps: params.fps,
    stopAfterItems: params.stopAfterItems,
    onLine: params.onLine,
    signal: params.signal
  })
}
