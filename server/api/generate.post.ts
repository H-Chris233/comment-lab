import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoBase64, generateFromVideoUrl } from '../services/ai'
import { parseDouyinLink, verifyVideoUrlReachable } from '../services/douyin'
import { ALLOWED_VIDEO_MIME_TYPES, fileToBase64DataUrl, getMaxVideoBytes, readMultipart } from '../services/file'
import { normalizeCommentItems, normalizeComments, parseJsonComments } from '../services/normalize'
import { buildPrompt } from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'

export default defineEventHandler(async (event) => {
  const requestId = createRequestId()

  try {
    // 1) 解析 form-data
    const form = await readMultipart(event)
    const field = (name: string) => form.find((f) => f.name === name)?.data?.toString('utf8')

    // 2) 校验参数
    const mode = validateMode(field('mode'))
    const count = validateCount(field('count'))
    const outputFormat = (field('outputFormat') || 'text') as 'text' | 'json'
    const dedupeRaw = field('dedupe')
    const cleanEmptyRaw = field('cleanEmpty')
    const dedupe = dedupeRaw == null ? true : parseBoolean(dedupeRaw)
    const cleanEmpty = cleanEmptyRaw == null ? true : parseBoolean(cleanEmptyRaw)
    const promptData = validatePromptLength(field('basePrompt'), field('extraPrompt'))

    const model = field('model')?.trim() || useRuntimeConfig().aliyunModel || DEFAULT_MODEL

    // 3) 获取视频输入源
    let aiResult

    // 4) 构造 prompt
    const prompt = buildPrompt({
      basePrompt: promptData.basePrompt,
      extraPrompt: promptData.extraPrompt,
      count,
      outputFormat
    })

    // 5) 调用 ai.ts
    if (mode === 'link') {
      const sourceUrl = validateUrl(field('url'))
      const parsed = await parseDouyinLink(sourceUrl, requestId)
      await verifyVideoUrlReachable(parsed.videoUrl!, requestId)

      aiResult = await generateFromVideoUrl({
        model,
        prompt,
        videoUrl: parsed.videoUrl!,
        requestId,
        fps: 1
      })
    } else {
      const maxBytes = getMaxVideoBytes()
      const file = validateVideoFile(form.find((f) => f.name === 'video'), maxBytes, ALLOWED_VIDEO_MIME_TYPES)
      const dataUrl = fileToBase64DataUrl(file.data!, file.type!)

      aiResult = await generateFromVideoBase64({
        model,
        prompt,
        dataUrl,
        requestId,
        fps: 1
      })
    }

    // 6) 清洗评论
    const normalized = outputFormat === 'json'
      ? (() => {
          const parsedItems = parseJsonComments(aiResult.rawText)
          if (!parsedItems) {
            throw createAppError({
              code: 'MODEL_OUTPUT_INVALID_FORMAT',
              message: '模型输出不是有效 JSON 数组，请切换文本模式或重试',
              statusCode: 502
            })
          }
          return normalizeCommentItems(parsedItems, { dedupe, cleanEmpty })
        })()
      : normalizeComments(aiResult.rawText, { dedupe, cleanEmpty })

    if (!normalized.comments.length) {
      throw createAppError({
        code: 'MODEL_OUTPUT_EMPTY',
        message: '结果格式异常，请重新生成',
        statusCode: 502
      })
    }

    if (normalized.comments.length < Math.ceil(count * 0.6)) {
      setResponseStatus(event, 422)
      return failure({
        code: 'MODEL_OUTPUT_INSUFFICIENT',
        message: '模型输出条数不足，请重试或调整提示词',
        requestId,
        data: {
          rawText: aiResult.rawText,
          requestedCount: count,
          finalCount: normalized.comments.length,
          beforeNormalizeCount: normalized.beforeCount,
          afterNormalizeCount: normalized.afterCount,
          model: aiResult.model
        }
      })
    }

    // 7) 返回结构化结果
    return success({
      comments: normalized.comments,
      rawText: aiResult.rawText,
      requestedCount: count,
      finalCount: normalized.comments.length,
      beforeNormalizeCount: normalized.beforeCount,
      afterNormalizeCount: normalized.afterCount,
      model: aiResult.model
    }, requestId)
  } catch (error) {
    const mapped = toApiError(error, requestId, {
      code: 'MODEL_CALL_FAILED',
      message: '模型调用失败，请稍后重试',
      statusCode: 502
    })

    // 错误码细分覆盖
    if (isAppError(error) && error.code === 'INVALID_INPUT') setResponseStatus(event, 400)
    else setResponseStatus(event, mapped.statusCode || 500)

    return failure(mapped)
  }
})
