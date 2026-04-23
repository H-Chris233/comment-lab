import type { ApiError, GenerateResultData } from '../../types/api'
import { getQuery, getRequestHeader, setResponseHeaders } from 'h3'
import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoFile, generateFromVideoUrl } from '../services/ai'
import { ALLOWED_VIDEO_MIME_TYPES, downloadVideoUrlToTempFile, getMaxVideoBytes, readMultipart, saveVideoUploadToTempFile } from '../services/file'
import { normalizeComments } from '../services/normalize'
import { fetchDouyinCommentSamplesByAwemeId, parseDouyinLink } from '../services/douyin'
import {
  buildExactLengthBundlePrompts,
  parseExactLengthBundleOutput,
  splitExactLengthTargetBundles,
  splitExactLengthTargets,
  stripExactLengthBundleHeadings
} from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateInputMode, validateModel, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'
import { assertAuthenticated } from '../services/auth'

const MAX_ROUNDS_BUFFER = 2
const SSE_HEARTBEAT_INTERVAL_MS = 15_000

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
    await assertAuthenticated(event)

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
    const includeCommentSamplesRaw = field('includeCommentSamples')
    const dedupe = dedupeRaw == null ? true : parseBoolean(dedupeRaw)
    const cleanEmpty = cleanEmptyRaw == null ? true : parseBoolean(cleanEmptyRaw)
    const includeCommentSamples = includeCommentSamplesRaw == null ? false : parseBoolean(includeCommentSamplesRaw)
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
      includeCommentSamples,
      inputMode,
      basePromptLength: promptData.basePrompt.length,
      model
    })

    const generationTimeoutMs = Number(useRuntimeConfig().generateTimeoutMs || 3_600_000)
    let generationTimeoutTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const clearGenerationTimeout = () => {
      if (generationTimeoutTimer == null) return
      clearTimeout(generationTimeoutTimer)
      generationTimeoutTimer = null
    }

    const clearHeartbeat = () => {
      if (heartbeatTimer == null) return
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    const startGenerationTimeout = () => {
      if (generationTimeoutTimer != null) return
      generationTimeoutTimer = setTimeout(() => {
        console.warn('[api.generate] generation timeout reached', {
          requestId,
          generationTimeoutMs
        })
        abortController.abort(new Error('REQUEST_TIMEOUT'))
        }, generationTimeoutMs)
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
      model
    })
    ensureClientConnected('after-meta')

    // 3) 获取视频输入源
    let localVideoPath = ''
    let cleanupVideoSource: null | (() => Promise<void>) = null
    let directVideoUrl = ''
    let videoTitle = ''
    let commentSamples: string[] = []
    let commentSamplesPromise: Promise<string[]> | null = null

    if (mode === 'link') {
      const sourceUrl = validateUrl(field('url'))
      console.info('[api.generate] step:link-parse:start', {
        requestId,
        sourceHost: new URL(sourceUrl).hostname
      })
      let parsed = await parseDouyinLink(sourceUrl, requestId)
      try {
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        videoTitle = parsed.title?.trim() || videoTitle
        if (includeCommentSamples) {
          const awemeId = parsed.awemeId || parsedVideoUrl.match(/\/video\/(\d{8,24})(?:[/?#]|$)/)?.[1] || ''
          if (awemeId) {
            commentSamplesPromise = fetchDouyinCommentSamplesByAwemeId(sourceUrl, awemeId, requestId)
          }
        }
        if (inputMode === 'url') {
          directVideoUrl = parsedVideoUrl
          console.info('[api.generate] step:link-parse:ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            hasTitle: Boolean(parsed.title),
            hasCover: Boolean(parsed.cover),
            transport: 'url'
          })
        } else {
          const downloaded = await downloadVideoUrlToTempFile({
            videoUrl: parsedVideoUrl,
            requestId,
            maxBytes: getMaxVideoBytes()
          })
          localVideoPath = downloaded.sourcePath
          cleanupVideoSource = downloaded.cleanup
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

        console.warn('[api.generate] step:link-download-retry-with-reparse', {
          requestId,
          reason: error.message
        })

        parsed = await parseDouyinLink(sourceUrl, requestId)
        const parsedVideoUrl = ensureParsedVideoUrl(parsed)
        videoTitle = parsed.title?.trim() || videoTitle
        if (includeCommentSamples && !commentSamplesPromise) {
          const awemeId = parsed.awemeId || parsedVideoUrl.match(/\/video\/(\d{8,24})(?:[/?#]|$)/)?.[1] || ''
          if (awemeId) {
            commentSamplesPromise = fetchDouyinCommentSamplesByAwemeId(sourceUrl, awemeId, requestId)
          }
        }
        if (inputMode === 'url') {
          directVideoUrl = parsedVideoUrl
          console.info('[api.generate] step:link-download-retry-ok', {
            requestId,
            parsedHost: new URL(parsedVideoUrl).hostname,
            transport: 'url'
          })
        } else {
          const downloaded = await downloadVideoUrlToTempFile({
            videoUrl: parsedVideoUrl,
            requestId,
            maxBytes: getMaxVideoBytes()
          })
          localVideoPath = downloaded.sourcePath
          cleanupVideoSource = downloaded.cleanup
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
      localVideoPath = uploaded.sourcePath
      cleanupVideoSource = uploaded.cleanup
        console.info('[api.generate] step:upload-accepted', {
          requestId,
          mime: file.type,
          bytes: file.data?.byteLength || 0,
          maxBytes,
          transport: 'file'
        })
      }

    if (commentSamplesPromise) {
      commentSamples = await commentSamplesPromise.catch((error) => {
        console.warn('[api.generate] comment-samples failed', {
          requestId,
          message: error instanceof Error ? error.message : 'unknown'
        })
        return []
      })
      console.info('[api.generate] step:comment-samples', {
        requestId,
        enabled: includeCommentSamples,
        count: commentSamples.length
      })
    }

    // 4)~7) 分批并行调用模型（按精确字数拆分），直到补足需求
    const finalComments: string[] = []
    let rawTextCombined = ''
    const promptTrace: string[] = []
    let beforeNormalizeCount = 0
    let afterNormalizeCount = 0
    let streamedItemCount = 0

    const maxRounds = Math.max(2, Math.ceil(count / 50) + MAX_ROUNDS_BUFFER)

    try {
      startGenerationTimeout()
      startHeartbeat()
      for (let round = 1; round <= maxRounds; round += 1) {
        ensureClientConnected(`round-${round}-start`)
        if (finalComments.length >= count) break

        const remaining = count - finalComments.length
        const roundLengthTargets = splitExactLengthTargets(remaining)
        const roundLengths = roundLengthTargets.filter(({ target }) => target > 0)
        const roundBundles = splitExactLengthTargetBundles(roundLengths, 5)
        console.info('[api.generate] step:round:start', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          targets: roundLengthTargets,
          bundles: roundBundles.map((bundle) => ({
            index: bundle.index,
            range: bundle.range,
            total: bundle.total,
            lengths: bundle.lengths.map((item) => item.length)
          }))
        })

        emitProgress('round', {
          requestId,
          round,
          maxRounds,
          currentCount: finalComments.length,
          remaining,
          targets: roundLengthTargets,
          bundles: roundBundles.map((bundle) => ({
            index: bundle.index,
            range: bundle.range,
            total: bundle.total,
            lengths: bundle.lengths.map((item) => item.length)
          }))
        })

        const promptSet = await buildExactLengthBundlePrompts({
          basePrompt: promptData.basePrompt,
          title: videoTitle,
          commentSamples
        }, roundBundles)

        const batchPrompts = promptSet.map(({ prompt }) => prompt)
        promptTrace.push(...batchPrompts)
        console.info('[api.generate] step:round:prompt', {
          requestId,
          round,
          prompts: promptSet.reduce<Record<string, string>>((acc, { bundle, prompt }) => {
            acc[bundle.range] = prompt
            return acc
          }, {})
        })

        const aiResults = await Promise.all(
          promptSet.map(({ bundle, prompt }) => {
            const commonParams = {
              model,
              prompt,
              requestId,
              fps: 1,
              stopAfterItems: bundle.total,
              onLine: (comment: string) => {
                if (streamedItemCount >= count) return
                streamedItemCount += 1
                emitProgress('item', {
                  requestId,
                  round,
                  bucket: bundle.range,
                  lengths: bundle.lengths.map((item) => item.length),
                  comment
                })
              },
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

        const normalizedResults = aiResults.map((result, index) => {
          const bundle = promptSet[index]?.bundle
          const parsedSections = bundle
            ? parseExactLengthBundleOutput(result.rawText, bundle.lengths)
            : {}

          const sectionResults = (bundle?.lengths || []).map((target) => {
            const sectionText = (parsedSections[target.length] || []).join('\n')
            const normalized = normalizeComments(sectionText, { dedupe, cleanEmpty })
            return {
              target,
              normalized,
              comments: normalized.comments.slice(0, target.target)
            }
          })

          return {
            normalized: sectionResults,
            rawText: result.rawText
          }
        })

        const roundComments = normalizedResults.flatMap(({ normalized }) => normalized.flatMap((entry) => entry.comments))
        console.info('[api.generate] step:round:normalized', {
          requestId,
          round,
          beforeCount: normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.beforeCount, 0), 0),
          afterCount: normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.afterCount, 0), 0),
          removedEmpty: normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.removedEmpty, 0), 0),
          removedDuplicate: normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.removedDuplicate, 0), 0),
          removedInvalid: normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.removedInvalid, 0), 0),
          cappedRoundCount: roundComments.length
        })

        beforeNormalizeCount += normalizedResults.reduce((sum, item) => sum + item.normalized.reduce((acc, entry) => acc + entry.normalized.beforeCount, 0), 0)
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
      clearGenerationTimeout()
      clearHeartbeat()
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
