import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoBase64 } from '../services/ai'
import { ALLOWED_VIDEO_MIME_TYPES, downloadVideoUrlAsDataUrl, fileToBase64DataUrl, getMaxVideoBytes, readMultipart } from '../services/file'
import { normalizeComments } from '../services/normalize'
import { parseDouyinLink } from '../services/douyin'
import { buildPrompt } from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'

const MAX_ITEMS_PER_MODEL_CALL = 60

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()

  try {
    console.info('[api.generate] start', { requestId })

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
        const downloaded = await downloadVideoUrlAsDataUrl({
          videoUrl: parsed.videoUrl!,
          requestId,
          maxBytes: getMaxVideoBytes()
        })
        dataUrl = downloaded.dataUrl
        cleanupVideoSource = downloaded.cleanup
        console.info('[api.generate] step:link-parse:ok', {
          requestId,
          parsedHost: new URL(parsed.videoUrl!).hostname,
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
        const downloaded = await downloadVideoUrlAsDataUrl({
          videoUrl: parsed.videoUrl!,
          requestId,
          maxBytes: getMaxVideoBytes()
        })
        dataUrl = downloaded.dataUrl
        cleanupVideoSource = downloaded.cleanup
        console.info('[api.generate] step:link-download-retry-ok', {
          requestId,
          parsedHost: new URL(parsed.videoUrl!).hostname,
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

    // 4)~7) 分批调用模型（每次最多 60 条），直到补足需求
    const finalComments: string[] = []
    let rawTextCombined = ''
    let beforeNormalizeCount = 0
    let afterNormalizeCount = 0

    const maxRounds = Math.max(2, Math.ceil(count / MAX_ITEMS_PER_MODEL_CALL) + 2)

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        if (finalComments.length >= count) break

      const remaining = count - finalComments.length
      const roundTarget = Math.min(remaining, MAX_ITEMS_PER_MODEL_CALL)
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

        const prompt = buildPrompt({
        basePrompt: promptData.basePrompt,
        extraPrompt: [
          promptData.extraPrompt,
          `这是第 ${round} 轮生成，本轮最多输出 ${MAX_ITEMS_PER_MODEL_CALL} 条，达到后立即停止。`,
          finalComments.length ? '避免与前文重复评论。' : ''
        ].filter(Boolean).join('\n'),
        count: promptTarget
      })

        const aiResult = await generateFromVideoBase64({
          model,
          prompt,
          dataUrl,
          requestId,
          fps: 1,
          stopAfterItems: MAX_ITEMS_PER_MODEL_CALL
        })

        console.info('[api.generate] step:round:ai-ok', {
          requestId,
          round,
          rawTextLength: aiResult.rawText.length,
          streamChunkCount: aiResult.streamChunkCount,
          finishReason: aiResult.finishReason
        })

        const normalized = normalizeComments(aiResult.rawText, { dedupe, cleanEmpty })

        const roundComments = normalized.comments.slice(0, MAX_ITEMS_PER_MODEL_CALL)
        console.info('[api.generate] step:round:normalized', {
          requestId,
          round,
          beforeCount: normalized.beforeCount,
          afterCount: normalized.afterCount,
          removedEmpty: normalized.removedEmpty,
          removedDuplicate: normalized.removedDuplicate,
          removedInvalid: normalized.removedInvalid,
          cappedRoundCount: roundComments.length
        })

        beforeNormalizeCount += normalized.beforeCount
        afterNormalizeCount += roundComments.length
        rawTextCombined = rawTextCombined ? `${rawTextCombined}\n${aiResult.rawText}` : aiResult.rawText

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
      setResponseStatus(event, 422)
      return failure({
        code: 'MODEL_OUTPUT_INSUFFICIENT',
        message: '模型输出条数不足，请重试或调整提示词',
        requestId,
        data: {
          rawText: rawTextCombined,
          requestedCount: count,
          finalCount: trimmedComments.length,
          beforeNormalizeCount,
          afterNormalizeCount: trimmedComments.length,
          model
        }
      })
    }

    console.info('[api.generate] success', {
      requestId,
      requestedCount: count,
      finalCount: trimmedComments.length,
      model
    })

    return success({
      comments: trimmedComments,
      rawText: rawTextCombined,
      requestedCount: count,
      finalCount: trimmedComments.length,
      beforeNormalizeCount,
      afterNormalizeCount: trimmedComments.length,
      model
    }, requestId)
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

    if (isAppError(error) && error.code === 'INVALID_INPUT') setResponseStatus(event, 400)
    else setResponseStatus(event, mapped.statusCode || 500)

    return failure(mapped)
  }
})
