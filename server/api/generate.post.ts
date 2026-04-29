import type { ApiError, GenerateResultData, GenerateStatusData } from '../../types/api'
import { getQuery, getRequestHeader, setResponseHeaders } from 'h3'
import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoFile, generateFromVideoUrl } from '../services/ai'
import {
  ALLOWED_VIDEO_MIME_TYPES,
  downloadVideoUrlToTempFile,
  getMaxDownloadVideoBytes,
  getMaxVideoBytes,
  readMultipart,
  saveVideoUploadToTempFile
} from '../services/file'
import { normalizeComments } from '../services/normalize'
import { countVisibleLengthWithoutEmojiAndPunctuation } from '../services/emoji'
import type { ParsedVideoResult } from '../services/douyin'
import { parseDouyinLink, resolveDouyinDownloadVideoUrl } from '../services/douyin'
import { ensureVideoUnderLimit, getMaxCompressVideoBytes } from '../services/video-compress'
import {
  STYLE_ORDER,
  buildStylePrompts,
  splitStyleTargets,
  stripExactLengthBundleHeadings
} from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateInputMode, validateModel, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'
import { spreadCommentsByPrefix } from '../services/normalize'

const MAX_ROUNDS_BUFFER = 2
const SSE_HEARTBEAT_INTERVAL_MS = 15_000

function mapUserFacingGenerateError(mapped: ReturnType<typeof toApiError>) {
  const next = { ...mapped }

  if (next.code === 'MODEL_CALL_FAILED') {
    next.message = '模型服务暂时不可用，请检查设置中的 Python 服务地址并重试'
    next.data = {
      ...next.data,
      action: '请先打开设置，确认 Python 服务地址和 API Key，然后重试。'
    }
    return next
  }

  if (next.code === 'VIDEO_FETCH_FAILED' || next.code === 'FILE_TOO_LARGE') {
    next.data = {
      ...next.data,
      action: '请检查视频链接是否可访问，或改用本地上传后重试。'
    }
    return next
  }

  if (next.code === 'STORAGE_PERMISSION_DENIED' || next.code === 'STORAGE_DISK_FULL' || next.code === 'STORAGE_PATH_MISSING') {
    next.statusCode = 507
    next.data = {
      ...next.data,
      action: '请检查本机磁盘空间和目录权限，必要时在设置中导出日志排查。'
    }
    return next
  }

  return next
}

type TempVideoSource = {
  sourcePath: string
  bytes: number
  cleanup: () => Promise<void>
  mime?: string
}

type RunOutcome =
  | { ok: true; data: GenerateResultData }
  | { ok: false; code: string; message: string; statusCode: number; data?: Record<string, unknown> }

type SseWriter = {
  send: (eventName: string, payload: unknown) => void
  close: () => void
}

type StatusEmitter = (status: GenerateStatusData) => void

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

function normalizeStatusPayload(payload: GenerateStatusData) {
  return {
    requestId: payload.requestId,
    phase: payload.phase,
    message: payload.message,
    attempt: payload.attempt,
    retryTimes: payload.retryTimes,
    round: payload.round,
    percent: payload.percent,
    downloadedBytes: payload.downloadedBytes,
    contentLength: payload.contentLength,
    details: payload.details
  }
}

async function compressVideoSourceIfNeeded(params: {
  source: TempVideoSource
  requestId?: string
  signal?: AbortSignal
  stepLabel: 'link-download' | 'upload'
  onStatus?: StatusEmitter
}) {
  const maxVideoBytes = getMaxCompressVideoBytes()
  if (params.source.bytes <= maxVideoBytes) {
    console.info(`[api.generate] step:${params.stepLabel}-compress:skip`, {
      requestId: params.requestId,
      bytes: params.source.bytes,
      maxBytes: maxVideoBytes
    })
    return params.source
  }

  console.info(`[api.generate] step:${params.stepLabel}-compress:start`, {
    requestId: params.requestId,
    bytes: params.source.bytes,
    maxBytes: maxVideoBytes,
    sourcePath: params.source.sourcePath
  })

  try {
    const compressed = await ensureVideoUnderLimit({
      sourcePath: params.source.sourcePath,
      maxBytes: maxVideoBytes,
      requestId: params.requestId,
      signal: params.signal,
      onStatus: params.onStatus
    })

    if (!compressed.compressed) {
      console.info(`[api.generate] step:${params.stepLabel}-compress:noop`, {
        requestId: params.requestId,
        bytes: params.source.bytes,
        maxBytes: maxVideoBytes
      })
      return params.source
    }

    console.info(`[api.generate] step:${params.stepLabel}-compress:done`, {
      requestId: params.requestId,
      sourceBytes: params.source.bytes,
      bytes: compressed.bytes,
      maxBytes: maxVideoBytes,
      compressed: true
    })

    return {
      sourcePath: compressed.sourcePath,
      bytes: compressed.bytes,
      cleanup: async () => {
        await compressed.cleanup().catch(() => {})
        await params.source.cleanup().catch(() => {})
      },
      mime: params.source.mime
    }
  } catch (error) {
    await params.source.cleanup().catch(() => {})
    throw error
  }
}

async function downloadDouyinLinkVideo(params: {
  parsed: ParsedVideoResult
  sourceUrl: string
  requestId?: string
  signal?: AbortSignal
  onStatus?: StatusEmitter
}) {
  const primaryVideoUrl = await resolveDouyinDownloadVideoUrl(
    params.parsed,
    params.sourceUrl,
    params.requestId,
    { region: 'CN' }
  )

  const downloaded = await downloadVideoUrlToTempFile({
    videoUrl: primaryVideoUrl,
    requestId: params.requestId,
    maxBytes: getMaxDownloadVideoBytes(),
    signal: params.signal,
    streamToDisk: true,
    onStatus: params.onStatus
  })

  return await compressVideoSourceIfNeeded({
    source: downloaded,
    requestId: params.requestId,
    signal: params.signal,
    stepLabel: 'link-download',
    onStatus: params.onStatus
  })
}

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()
  const streamMode = isSseRequest(event)
  const sse = streamMode ? createSseWriter(event) : null
  const abortController = new AbortController()
  let clientDisconnected = false

  event.node.req.on('aborted', () => {
    clientDisconnected = true
    abortController.abort(new Error('CLIENT_ABORTED'))
    console.warn('[api.generate] client aborted', { requestId })
  })

  event.node.res.on('close', () => {
    if (clientDisconnected || event.node.res.writableEnded) return
    clientDisconnected = true
    abortController.abort(new Error('CLIENT_ABORTED'))
    console.warn('[api.generate] response closed before completion', { requestId })
  })

  const emitProgress = (eventName: string, payload: unknown) => {
    if (!sse || clientDisconnected) return
    sse.send(eventName, payload)
  }

  const emitStatus = (payload: GenerateStatusData) => {
    if (!sse || clientDisconnected) return
    sse.send('status', normalizeStatusPayload(payload))
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
    const enableThinkingRaw = field('enableThinking')
    const dedupe = dedupeRaw == null ? true : parseBoolean(dedupeRaw)
    const cleanEmpty = cleanEmptyRaw == null ? true : parseBoolean(cleanEmptyRaw)
    const enableThinking = enableThinkingRaw == null ? false : parseBoolean(enableThinkingRaw)
    const promptData = validatePromptLength(field('basePrompt'))
    const inputMode = validateInputMode(field('inputMode')) ?? (mode === 'link' ? 'url' : 'file')
    const validatedModel = validateModel(field('model'))

    if (mode === 'upload' && inputMode === 'url') {
      throw createAppError({
        code: 'INVALID_INPUT',
        message: 'upload 模式不支持 inputMode=url',
        statusCode: 400
      })
    }

    const model = validatedModel || useRuntimeConfig().aliyunModel || DEFAULT_MODEL
    console.info('[api.generate] step:validated', {
      requestId,
      mode,
      count,
      dedupe,
      cleanEmpty,
      enableThinking,
      inputMode,
      basePromptLength: promptData.basePrompt.length,
      model
    })

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const clearHeartbeat = () => {
      if (heartbeatTimer == null) return
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    const startHeartbeat = () => {
      if (!streamMode || !sse || heartbeatTimer != null) return
      heartbeatTimer = setInterval(() => {
        if (clientDisconnected) return
        emitProgress('ping', {
          requestId,
          ts: Date.now()
        })
      }, SSE_HEARTBEAT_INTERVAL_MS)
      heartbeatTimer.unref?.()
    }

    emitProgress('meta', {
      requestId,
      mode,
      requestedCount: count,
      model,
      enableThinking
    })
    emitStatus({
      requestId,
      phase: 'parsing',
      message: mode === 'link' ? '正在解析视频链接' : '正在准备上传视频'
    })
    ensureClientConnected('after-meta')

    // 3) 获取视频输入源
    let localVideoPath = ''
    let cleanupVideoSource: null | (() => Promise<void>) = null
    let directVideoUrl = ''
    let videoTitle = ''

    if (mode === 'link') {
      const sourceUrl = validateUrl(field('url'))
      emitStatus({
        requestId,
        phase: 'parsing',
        message: '正在解析视频链接'
      })
      console.info('[api.generate] step:link-parse:start', {
        requestId,
        sourceHost: new URL(sourceUrl).hostname
      })
      let parsed = await parseDouyinLink(sourceUrl, requestId)
      try {
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        videoTitle = parsed.title?.trim() || videoTitle
        if (inputMode === 'url') {
          directVideoUrl = parsedVideoUrl
          emitStatus({
            requestId,
            phase: 'parsing',
            message: '链接解析完成，正在调用模型'
          })
          console.info('[api.generate] step:link-parse:ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            hasTitle: Boolean(parsed.title),
            hasCover: Boolean(parsed.cover),
            transport: 'url'
          })
        } else {
          emitStatus({
            requestId,
            phase: 'downloading',
            message: '正在下载视频'
          })
          const downloaded = await downloadDouyinLinkVideo({
            parsed,
            sourceUrl,
            requestId,
            signal: abortController.signal,
            onStatus: emitStatus
          })
          localVideoPath = downloaded.sourcePath
          cleanupVideoSource = downloaded.cleanup
          emitStatus({
            requestId,
            phase: downloaded.bytes > getMaxCompressVideoBytes() ? 'compressing' : 'calling_model',
            message: downloaded.bytes > getMaxCompressVideoBytes()
              ? '正在压缩视频'
              : '视频下载完成，正在调用模型'
          })
          console.info('[api.generate] step:link-parse:ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            hasTitle: Boolean(parsed.title),
            hasCover: Boolean(parsed.cover),
            downloadedBytes: downloaded.bytes,
            transport: 'file'
          })
        }
      } catch (error) {
        if (!(isAppError(error) && error.code === 'VIDEO_FETCH_FAILED')) throw error

        emitStatus({
          requestId,
          phase: 'retrying',
          message: '下载失败，正在重新解析并重试'
        })
        console.warn('[api.generate] step:link-download-retry-with-reparse', {
          requestId,
          reason: error.message
        })

        parsed = await parseDouyinLink(sourceUrl, requestId)
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        videoTitle = parsed.title?.trim() || videoTitle
        if (inputMode === 'url') {
          directVideoUrl = parsedVideoUrl
          emitStatus({
            requestId,
            phase: 'parsing',
            message: '链接解析完成，正在调用模型'
          })
          console.info('[api.generate] step:link-download-retry-ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            transport: 'url'
          })
        } else {
          emitStatus({
            requestId,
            phase: 'downloading',
            message: '正在下载视频'
          })
          const downloaded = await downloadDouyinLinkVideo({
            parsed,
            sourceUrl,
            requestId,
            signal: abortController.signal,
            onStatus: emitStatus
          })
          localVideoPath = downloaded.sourcePath
          cleanupVideoSource = downloaded.cleanup
          emitStatus({
            requestId,
            phase: downloaded.bytes > getMaxCompressVideoBytes() ? 'compressing' : 'calling_model',
            message: downloaded.bytes > getMaxCompressVideoBytes()
              ? '正在压缩视频'
              : '视频下载完成，正在调用模型'
          })
          console.info('[api.generate] step:link-download-retry-ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            downloadedBytes: downloaded.bytes,
            transport: 'file'
          })
        }
      }
    } else {
      const maxBytes = getMaxVideoBytes()
      const file = validateVideoFile(form.find((f) => f.name === 'video'), maxBytes, ALLOWED_VIDEO_MIME_TYPES)
      const uploaded = await saveVideoUploadToTempFile(file, requestId)
      emitStatus({
        requestId,
        phase: uploaded.bytes > getMaxCompressVideoBytes() ? 'compressing' : 'calling_model',
        message: uploaded.bytes > getMaxCompressVideoBytes()
          ? '正在压缩上传视频'
          : '上传完成，正在调用模型'
      })
      const compressed = await compressVideoSourceIfNeeded({
        source: uploaded,
        requestId,
        signal: abortController.signal,
        stepLabel: 'upload',
        onStatus: emitStatus
      })
      localVideoPath = compressed.sourcePath
      cleanupVideoSource = compressed.cleanup
      console.info('[api.generate] step:upload-accepted', {
        requestId,
        mime: file.type,
        bytes: uploaded.bytes,
        maxBytes,
        transport: 'file'
      })
    }

    // 4)~7) 分批并行调用模型（按风格桶拆分），直到补足需求
    const finalComments: string[] = []
    let rawTextCombined = ''
    const promptTrace: string[] = []
    let beforeNormalizeCount = 0
    let afterNormalizeCount = 0
    let streamedItemCount = 0

    const maxRounds = Math.max(2, Math.ceil(count / 50) + MAX_ROUNDS_BUFFER)

    try {
      startHeartbeat()
      for (let round = 1; round <= maxRounds; round += 1) {
        ensureClientConnected(`round-${round}-start`)
        if (finalComments.length >= count) break

        const remaining = count - finalComments.length
        const roundStyleTargets = splitStyleTargets(remaining)
        const activeStyles = STYLE_ORDER.filter((style) => roundStyleTargets[style] > 0)
        console.info('[api.generate] step:round:start', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          targets: roundStyleTargets,
          styles: activeStyles
        })

        emitStatus({
          requestId,
          phase: 'calling_model',
          message: `正在调用模型（第 ${round} 轮）`,
          round
        })

        emitProgress('round', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          targets: roundStyleTargets,
          styles: activeStyles
        })

        const promptSet = await buildStylePrompts({
          basePrompt: promptData.basePrompt,
          title: videoTitle
        }, roundStyleTargets)

        const promptEntries = activeStyles.map((style) => ({
          style,
          target: roundStyleTargets[style],
          prompt: promptSet[style]
        }))

        const batchPrompts = promptEntries.map(({ prompt }) => prompt)
        promptTrace.push(...batchPrompts)
        console.info('[api.generate] step:round:prompt', {
          requestId,
          round,
          prompts: promptEntries.reduce<Record<string, string>>((acc, { style, prompt }) => {
            acc[style] = prompt
            return acc
          }, {})
        })

        const aiResults = await Promise.all(
          promptEntries.map(({ style, target, prompt }) => {
            const commonParams = {
              model,
              prompt,
              requestId,
              fps: 1,
              stopAfterItems: target,
              onLine: (comment: string) => {
                if (countVisibleLengthWithoutEmojiAndPunctuation(comment) > 30) return
                if (streamedItemCount >= count) return
                streamedItemCount += 1
                emitProgress('item', {
                  requestId,
                  round,
                  bucket: style,
                  target,
                  comment
                })
              },
              enableThinking,
              signal: abortController.signal
            }

            return inputMode === 'url'
              ? generateFromVideoUrl({
                  ...commonParams,
                  videoUrl: directVideoUrl
                })
              : generateFromVideoFile({
                  ...commonParams,
                  videoPath: localVideoPath
                })
          })
        )
        ensureClientConnected(`round-${round}-after-ai`)

        console.info('[api.generate] step:round:ai-ok', {
          requestId,
          round,
          rawTextLengths: aiResults.map((result) => result.rawText.length),
          streamChunkCounts: aiResults.map((result) => result.streamChunkCount),
          finishReasons: aiResults.map((result) => result.finishReason)
        })

        emitStatus({
          requestId,
          phase: 'normalizing',
          message: `模型已返回，正在整理结果（第 ${round} 轮）`,
          round
        })

        const normalizedResults = aiResults.map((result, index) => {
          return {
            target: promptEntries[index]?.target || 0,
            normalized: normalizeComments(result.rawText, { dedupe, cleanEmpty }),
            rawText: result.rawText
          }
        })

        const roundComments = normalizedResults.flatMap(({ normalized, target }) => normalized.comments.slice(0, target))
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

        emitStatus({
          requestId,
          phase: 'normalizing',
          message: `正在合并评论结果（第 ${round} 轮）`,
          round
        })

        beforeNormalizeCount += normalizedResults.reduce((sum, item) => sum + item.normalized.beforeCount, 0)
        afterNormalizeCount += roundComments.length
        const batchRawText = stripExactLengthBundleHeadings(aiResults.map((result) => result.rawText).join('\n'))
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

        emitStatus({
          requestId,
          phase: 'normalizing',
          message: `第 ${round} 轮处理完成，继续生成下一轮`,
          round
        })

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
      clearHeartbeat()
      if (cleanupVideoSource) await cleanupVideoSource()
    }

    const arrangedComments = spreadCommentsByPrefix(finalComments, 2)
    const trimmedComments = arrangedComments.slice(0, count)
    ensureClientConnected('post-process')
    emitStatus({
      requestId,
      phase: 'normalizing',
      message: '正在整理最终结果'
    })
    console.info('[api.generate] step:post-process', {
      requestId,
      requestedCount: count,
      finalCount: trimmedComments.length,
      beforeNormalizeCount,
      afterNormalizeCount: trimmedComments.length
    })

    if (!trimmedComments.length) {
      return {
        ok: false,
        code: 'MODEL_OUTPUT_EMPTY',
        message: '结果格式异常，请重新生成',
        statusCode: 422,
        data: {
          rawText: rawTextCombined,
          promptTrace,
          requestedCount: count,
          finalCount: 0,
          beforeNormalizeCount,
          afterNormalizeCount: 0,
          model
        }
      }
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

    emitStatus({
      requestId,
      phase: 'done',
      message: '生成完成'
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

    const mapped = mapUserFacingGenerateError(toApiError(error, requestId, {
      code: 'MODEL_CALL_FAILED',
      message: '模型调用失败，请稍后重试',
      statusCode: 502
    }))

    if (streamMode && sse) {
      if (clientDisconnected || (error as any)?.code === 'CLIENT_ABORTED') return
      sse.send('error', failure({
        code: mapped.code,
        message: mapped.message,
        requestId: mapped.requestId,
        data: mapped.data
      }))
      sse.close()
      return
    }

    if (isAppError(error) && error.code === 'INVALID_INPUT') setResponseStatus(event, 400)
    else setResponseStatus(event, mapped.statusCode || 500)

    return failure(mapped)
  }
})
