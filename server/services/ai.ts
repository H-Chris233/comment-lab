import OpenAI from 'openai'
import { createAppError } from '../utils/errors'

const DEFAULT_FPS = 1

type GenerateBaseParams = {
  model: string
  prompt: string
  requestId: string
  fps?: number
  stopAfterItems?: number
}

export interface GenerateAiResult {
  rawText: string
  model: string
  usage?: unknown
  finishReason?: string | null
  streamChunkCount: number
  durationMs: number
}

export function createAliyunClient() {
  const config = useRuntimeConfig()

  return new OpenAI({
    apiKey: config.aliyunApiKey,
    baseURL: config.aliyunBaseUrl
  })
}

function buildMessages(prompt: string, videoUrlOrDataUrl: string, fps = DEFAULT_FPS) {
  return [
    {
      role: 'system',
      content: '你是一个中文短视频评论生成助手。只输出评论内容，不解释。'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'video_url',
          video_url: {
            url: videoUrlOrDataUrl,
            fps
          }
        }
      ]
    }
  ]
}

function countItemsByLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length
}

function takeFirstItems(raw: string, maxItems?: number) {
  if (!maxItems || maxItems <= 0) return raw.trim()

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.slice(0, maxItems).join('\n').trim()
}

async function generateStreamed(params: GenerateBaseParams & { inputKind: 'url' | 'base64'; videoSource: string }): Promise<GenerateAiResult> {
  const start = Date.now()
  const fps = params.fps ?? DEFAULT_FPS
  const client = createAliyunClient()
  console.info('[ai.generate] start', {
    requestId: params.requestId,
    model: params.model,
    inputKind: params.inputKind,
    fps,
    stopAfterItems: params.stopAfterItems,
    promptLength: params.prompt.length
  })

  let streamChunkCount = 0
  let usage: unknown
  let finishReason: string | null = null
  let rawAccumulated = ''
  let firstChunkLogged = false

  try {
    const stream = await client.chat.completions.create({
      model: params.model,
      stream: true,
      modalities: ['text'],
      stream_options: { include_usage: true },
      messages: buildMessages(params.prompt, params.videoSource, fps)
    } as any)

    for await (const chunk of stream as any) {
      streamChunkCount += 1

      if (chunk?.usage) usage = chunk.usage

      const choice = chunk?.choices?.[0]
      if (choice?.finish_reason) finishReason = choice.finish_reason

      const content = choice?.delta?.content
      if (typeof content === 'string') {
        rawAccumulated += content
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part?.text === 'string') rawAccumulated += part.text
        }
      }

      if (!firstChunkLogged) {
        firstChunkLogged = true
        console.info('[ai.generate] step:first-chunk', {
          requestId: params.requestId,
          streamChunkCount
        })
      }

      if (streamChunkCount % 50 === 0) {
        console.info('[ai.generate] step:stream-progress', {
          requestId: params.requestId,
          streamChunkCount,
          currentTextLength: rawAccumulated.length,
          currentLineCount: countItemsByLines(rawAccumulated)
        })
      }

      if (params.stopAfterItems && countItemsByLines(rawAccumulated) >= params.stopAfterItems) {
        finishReason = 'limit_reached'
        console.info('[ai.generate] step:stop-after-items', {
          requestId: params.requestId,
          streamChunkCount,
          currentLineCount: countItemsByLines(rawAccumulated),
          stopAfterItems: params.stopAfterItems
        })
        break
      }
    }
  } catch (error) {
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
    mode: 'chat.completions',
    inputKind: params.inputKind,
    fps,
    stopAfterItems: params.stopAfterItems,
    streamChunkCount,
    rawTextLength: rawText.length,
    durationMs,
    finishReason
  })

  if (!rawText) {
    throw createAppError({ code: 'MODEL_OUTPUT_EMPTY', message: '模型输出为空，请重试', statusCode: 502 })
  }

  return {
    rawText,
    model: params.model,
    usage,
    finishReason,
    streamChunkCount,
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
}) {
  return generateStreamed({
    model: params.model,
    prompt: params.prompt,
    videoSource: params.videoUrl,
    requestId: params.requestId,
    fps: params.fps,
    inputKind: 'url',
    stopAfterItems: params.stopAfterItems
  })
}

export async function generateFromVideoBase64(params: {
  model: string
  prompt: string
  dataUrl: string
  requestId: string
  fps?: number
  stopAfterItems?: number
}) {
  return generateStreamed({
    model: params.model,
    prompt: params.prompt,
    videoSource: params.dataUrl,
    requestId: params.requestId,
    fps: params.fps,
    inputKind: 'base64',
    stopAfterItems: params.stopAfterItems
  })
}
