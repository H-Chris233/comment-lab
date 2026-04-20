import { createAppError } from '../utils/errors'

const DEFAULT_FPS = 1

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
    body: JSON.stringify(buildSidecarPayload(params)),
    signal: params.signal
  })

  const payload = await response.json().catch(() => null) as null | {
    rawText?: unknown
    model?: unknown
    detail?: unknown
    message?: unknown
  }

  if (!response.ok) {
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : typeof payload?.message === 'string'
        ? payload.message
        : `Python sidecar 请求失败（HTTP ${response.status}）`
    throw createAppError({
      code: 'MODEL_CALL_FAILED',
      message: detail,
      statusCode: 502
    })
  }

  return {
    rawText: typeof payload?.rawText === 'string' ? payload.rawText : '',
    model: typeof payload?.model === 'string' ? payload.model : params.model
  }
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

  let usage: unknown
  let finishReason: string | null = 'stop'
  let rawAccumulated = ''
  const lineCollector = createCompleteLineCollector()
  let emittedItemCount = 0

  try {
    const result = await callPythonSidecar({
      model: params.model,
      prompt: params.prompt,
      fps,
      inputMode: params.inputMode,
      videoUrl: params.videoUrl,
      videoPath: params.videoPath,
      requestId: params.requestId,
      signal: params.signal
    })

    rawAccumulated = result.rawText
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
    if ((error as any)?.name === 'AbortError') {
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
    usage,
    finishReason
  })

  return {
    rawText,
    model: params.model,
    usage,
    finishReason,
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
