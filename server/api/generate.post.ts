import type { ApiError, GenerateResultData } from '../../types/api'
import { getQuery, getRequestHeader, setResponseHeaders } from 'h3'
import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoBase64 } from '../services/ai'
import { ALLOWED_VIDEO_MIME_TYPES, downloadVideoUrlAsDataUrl, fileToBase64DataUrl, getMaxVideoBytes, readMultipart } from '../services/file'
import { normalizeComments } from '../services/normalize'
import { parseDouyinLink } from '../services/douyin'
import { STYLE_TARGET_PER_CALL, buildStylePrompts } from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'

const MAX_ITEMS_PER_MODEL_CALL = STYLE_TARGET_PER_CALL
const STYLE_ORDER = ['long', 'medium', 'short'] as const
const BATCH_TARGET = MAX_ITEMS_PER_MODEL_CALL * STYLE_ORDER.length

type RunOutcome =
  | { ok: true; data: GenerateResultData }
  | { ok: false; code: string; message: string; statusCode: number; data?: Record<string, unknown> }

type SseWriter = {
  send: (eventName: string, payload: unknown) => void
  close: () => void
}

function ensureParsedVideoUrl(parsed: { videoUrl?: string }) {
  if (!parsed.videoUrl) {
    throw createAppError({
      code: 'PARSE_LINK_FAILED',
      message: '链接解析失败，请改为上传视频',
      statusCode: 422
    })
  }
  return parsed.videoUrl
}

function isSseRequest(event: any) {
  const accept = getRequestHeader(event, 'accept') || ''
  const query = getQuery(event)
  const streamQuery = String(query.stream || '')
  return accept.includes('text/event-stream') || streamQuery === '1' || streamQuery.toLowerCase() === 'true'
}

function createSseWriter(event: any): SseWriter {
  setResponseStatus(event, 200)
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  const res = event.node.res
  res.flushHeaders?.()

  return {
    send(eventName, payload) {
      if (res.writableEnded || res.destroyed) return
      res.write(`event: ${eventName}\n`)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    },
    close() {
      if (res.writableEnded || res.destroyed) return
      res.end()
    }
  }
}

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()
  const streamMode = isSseRequest(event)
  const sse = streamMode ? createSseWriter(event) : null
  const abortController = new AbortController()
  let clientDisconnected = false

  event.node.req.on('aborted', () => {
    clientDisconnected = true
    abortController.abort()
    console.warn('[api.generate] client aborted', { requestId })
  })

  event.node.res.on('close', () => {
    if (clientDisconnected || event.node.res.writableEnded) return
    clientDisconnected = true
    abortController.abort()
    console.warn('[api.generate] response closed before completion', { requestId })
  })

  const emitProgress = (eventName: string, payload: unknown) => {
    if (!sse || clientDisconnected) return
    sse.send(eventName, payload)
  }

  const ensureClientConnected = (step: string) => {
    if (!clientDisconnected) return
    console.warn('[api.generate] stop:client-disconnected', { requestId, step })
    throw createAppError({
      code: 'CLIENT_ABORTED',
      message: '客户端已断开连接',
      statusCode: 499,
      expose: false
    })
  }

  const executeGenerate = async (): Promise<RunOutcome> => {
    console.info('[api.generate] start', { requestId, streamMode })
    ensureClientConnected('start')

    // 1) 解析 form-data
    const form = await readMultipart(event)
    const field = (name: string) => form.find((f) => f.name === name)?.data?.toString('utf8')
    console.info('[api.generate] step:read-multipart', {
      requestId,
      fields: form.map((f) => f.name).filter(Boolean)
    })

    // 2) 校验参数
    const mode = validateMode(field('mode'))
    const count = validateCount(field('count'))
    const dedupeRaw = field('dedupe')
    const cleanEmptyRaw = field('cleanEmpty')
    const dedupe = dedupeRaw == null ? true : parseBoolean(dedupeRaw)
    const cleanEmpty = cleanEmptyRaw == null ? true : parseBoolean(cleanEmptyRaw)
    const promptData = validatePromptLength(field('basePrompt'), field('extraPrompt'))

    const model = field('model')?.trim() || useRuntimeConfig().aliyunModel || DEFAULT_MODEL
    console.info('[api.generate] step:validated', {
      requestId,
      mode,
      count,
      dedupe,
      cleanEmpty,
      basePromptLength: promptData.basePrompt.length,
      extraPromptLength: promptData.extraPrompt?.length || 0,
      model
    })

    emitProgress('meta', {
      requestId,
      mode,
      requestedCount: count,
      model
    })
    ensureClientConnected('after-meta')

    // 3) 获取视频输入源
    let dataUrl = ''
    let cleanupVideoSource: null | (() => Promise<void>) = null

    if (mode === 'link') {
      const sourceUrl = validateUrl(field('url'))
      console.info('[api.generate] step:link-parse:start', {
        requestId,
        sourceHost: new URL(sourceUrl).hostname
      })
      let parsed = await parseDouyinLink(sourceUrl, requestId)
      try {
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        const downloaded = await downloadVideoUrlAsDataUrl({
          videoUrl: parsedVideoUrl,
          requestId,
          maxBytes: getMaxVideoBytes()
        })
        dataUrl = downloaded.dataUrl
        cleanupVideoSource = downloaded.cleanup
        console.info('[api.generate] step:link-parse:ok', {
          requestId,
          parsedHost: new URL(parsedVideoUrl).hostname,
          hasTitle: Boolean(parsed.title),
          hasCover: Boolean(parsed.cover),
          downloadedBytes: downloaded.bytes
        })
      } catch (error) {
        if (!(isAppError(error) && error.code === 'VIDEO_FETCH_FAILED')) throw error

        console.warn('[api.generate] step:link-download-retry-with-reparse', {
          requestId,
          reason: error.message
        })

        parsed = await parseDouyinLink(sourceUrl, requestId)
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        const downloaded = await downloadVideoUrlAsDataUrl({
          videoUrl: parsedVideoUrl,
          requestId,
          maxBytes: getMaxVideoBytes()
        })
        dataUrl = downloaded.dataUrl
        cleanupVideoSource = downloaded.cleanup
        console.info('[api.generate] step:link-download-retry-ok', {
          requestId,
          parsedHost: new URL(parsedVideoUrl).hostname,
          downloadedBytes: downloaded.bytes
        })
      }
    } else {
      const maxBytes = getMaxVideoBytes()
      const file = validateVideoFile(form.find((f) => f.name === 'video'), maxBytes, ALLOWED_VIDEO_MIME_TYPES)
      dataUrl = fileToBase64DataUrl(file.data!, file.type!)
      console.info('[api.generate] step:upload-accepted', {
        requestId,
        mime: file.type,
        bytes: file.data?.byteLength || 0,
        maxBytes
      })
    }

    // 4)~7) 分批并行调用模型（每批 3 个风格，各 60 条），直到补足需求
    const finalComments: string[] = []
    let rawTextCombined = ''
    const promptTrace: string[] = []
    let beforeNormalizeCount = 0
    let afterNormalizeCount = 0
    let streamedItemCount = 0

    const maxRounds = Math.max(2, Math.ceil(count / BATCH_TARGET) + 2)

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        ensureClientConnected(`round-${round}-start`)
        if (finalComments.length >= count) break

        const remaining = count - finalComments.length
        const roundTarget = Math.min(remaining, BATCH_TARGET)
        const promptTarget = MAX_ITEMS_PER_MODEL_CALL
        console.info('[api.generate] step:round:start', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          roundTarget,
          promptTarget
        })

        emitProgress('round', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          roundTarget,
          promptTarget
        })

        const promptSet = await buildStylePrompts({
          basePrompt: promptData.basePrompt,
          extraPrompt: [
            promptData.extraPrompt,
            finalComments.length ? '避免与前文重复评论。' : ''
          ].filter(Boolean).join('\n')
        })

        const batchPrompts = STYLE_ORDER.map((style) => promptSet[style])
        promptTrace.push(...batchPrompts)
        console.info('[api.generate] step:round:prompt', {
          requestId,
          round,
          prompts: STYLE_ORDER.reduce<Record<string, string>>((acc, style, index) => {
            acc[style] = batchPrompts[index]
            return acc
          }, {})
        })

        const aiResults = await Promise.all(
          STYLE_ORDER.map((style, index) => generateFromVideoBase64({
            model,
            prompt: batchPrompts[index],
            dataUrl,
            requestId,
            fps: 1,
            stopAfterItems: MAX_ITEMS_PER_MODEL_CALL,
            onLine: (comment) => {
              if (streamedItemCount >= count) return
              streamedItemCount += 1
              emitProgress('item', {
                requestId,
                round,
                style,
                comment
              })
            },
            signal: abortController.signal
          }))
        )
        ensureClientConnected(`round-${round}-after-ai`)

        console.info('[api.generate] step:round:ai-ok', {
          requestId,
          round,
          rawTextLengths: aiResults.map((result) => result.rawText.length),
          streamChunkCounts: aiResults.map((result) => result.streamChunkCount),
          finishReasons: aiResults.map((result) => result.finishReason)
        })

        const normalizedResults = aiResults.map((result) => ({
          normalized: normalizeComments(result.rawText, { dedupe, cleanEmpty })
        }))

        const roundComments = normalizedResults.flatMap(({ normalized }) => normalized.comments.slice(0, MAX_ITEMS_PER_MODEL_CALL))
        console.info('[api.generate] step:round:normalized', {
          requestId,
          round,
          beforeCount: normalizedResults.reduce((sum, item) => sum + item.normalized.beforeCount, 0),
          afterCount: normalizedResults.reduce((sum, item) => sum + item.normalized.afterCount, 0),
          removedEmpty: normalizedResults.reduce((sum, item) => sum + item.normalized.removedEmpty, 0),
          removedDuplicate: normalizedResults.reduce((sum, item) => sum + item.normalized.removedDuplicate, 0),
          removedInvalid: normalizedResults.reduce((sum, item) => sum + item.normalized.removedInvalid, 0),
          cappedRoundCount: roundComments.length
        })

        beforeNormalizeCount += normalizedResults.reduce((sum, item) => sum + item.normalized.beforeCount, 0)
        afterNormalizeCount += roundComments.length
        const batchRawText = aiResults.map((result) => result.rawText).join('\n')
        rawTextCombined = rawTextCombined ? `${rawTextCombined}\n${batchRawText}` : batchRawText

        const beforeLen = finalComments.length
        if (dedupe) {
          const seen = new Set(finalComments)
          for (const c of roundComments) {
            if (!seen.has(c)) {
              seen.add(c)
              finalComments.push(c)
            }
          }
        } else {
          finalComments.push(...roundComments)
        }
        console.info('[api.generate] step:round:merged', {
          requestId,
          round,
          addedCount: finalComments.length - beforeLen,
          totalCount: finalComments.length
        })

        emitProgress('partial', {
          requestId,
          round,
          comments: finalComments.slice(0, count),
          finalCount: finalComments.length,
          beforeNormalizeCount,
          afterNormalizeCount: Math.min(finalComments.length, count),
          rawText: rawTextCombined,
          promptTrace
        })
        ensureClientConnected(`round-${round}-after-partial`)

        // 本轮没有新增，避免无意义重试
        if (finalComments.length === beforeLen) {
          console.warn('[api.generate] step:round:stopped-no-growth', {
            requestId,
            round,
            totalCount: finalComments.length
          })
          break
        }
      }
    } finally {
      if (cleanupVideoSource) await cleanupVideoSource()
    }

    const trimmedComments = finalComments.slice(0, count)
    ensureClientConnected('post-process')
    console.info('[api.generate] step:post-process', {
      requestId,
      requestedCount: count,
      finalCount: trimmedComments.length,
      beforeNormalizeCount,
      afterNormalizeCount: trimmedComments.length
    })

    if (!trimmedComments.length) {
      throw createAppError({
        code: 'MODEL_OUTPUT_EMPTY',
        message: '结果格式异常，请重新生成',
        statusCode: 502
      })
    }

    if (trimmedComments.length < Math.ceil(count * 0.6)) {
      console.warn('[api.generate] step:insufficient', {
        requestId,
        requestedCount: count,
        finalCount: trimmedComments.length,
        threshold: Math.ceil(count * 0.6)
      })

        return {
          ok: false,
          code: 'MODEL_OUTPUT_INSUFFICIENT',
          message: '模型输出条数不足，请重试或调整提示词',
          statusCode: 422,
          data: {
            rawText: rawTextCombined,
            promptTrace,
            requestedCount: count,
            finalCount: trimmedComments.length,
            beforeNormalizeCount,
            afterNormalizeCount: trimmedComments.length,
            model
        }
      }
    }

    console.info('[api.generate] success', {
      requestId,
      requestedCount: count,
      finalCount: trimmedComments.length,
      model
    })

    return {
      ok: true,
      data: {
        comments: trimmedComments,
        rawText: rawTextCombined,
        promptTrace,
        requestedCount: count,
        finalCount: trimmedComments.length,
        beforeNormalizeCount,
        afterNormalizeCount: trimmedComments.length,
        model
      }
    }
  }

  try {
    const outcome = await executeGenerate()

    if (streamMode && sse) {
      if (clientDisconnected) return
      if (outcome.ok) {
        sse.send('done', success(outcome.data, requestId))
      } else {
        sse.send('error', failure({
          code: outcome.code,
          message: outcome.message,
          requestId,
          data: outcome.data
        }))
      }
      sse.close()
      return
    }

    if (!outcome.ok) {
      setResponseStatus(event, outcome.statusCode)
      return failure({
        code: outcome.code,
        message: outcome.message,
        requestId,
        data: outcome.data
      })
    }

    return success(outcome.data, requestId)
  } catch (error) {
    console.error('[api.generate] failed', {
      requestId,
      message: error instanceof Error ? error.message : 'unknown',
      code: typeof (error as any)?.code === 'string' ? (error as any).code : undefined,
      stack: error instanceof Error ? error.stack : undefined
    })

    const mapped = toApiError(error, requestId, {
      code: 'MODEL_CALL_FAILED',
      message: '模型调用失败，请稍后重试',
      statusCode: 502
    })

    if (streamMode && sse) {
      if (clientDisconnected || (error as any)?.code === 'CLIENT_ABORTED') return
      sse.send('error', failure({
        code: mapped.code,
        message: mapped.message,
        requestId: mapped.requestId
      }))
      sse.close()
      return
    }

    if (isAppError(error) && error.code === 'INVALID_INPUT') setResponseStatus(event, 400)
    else setResponseStatus(event, mapped.statusCode || 500)

    return failure(mapped)
  }
})
