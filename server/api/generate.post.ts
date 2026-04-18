import { DEFAULT_MODEL } from '../../types/prompt'
import { generateFromVideoBase64, generateFromVideoUrl } from '../services/ai'
import { ALLOWED_VIDEO_MIME_TYPES, fileToBase64DataUrl, getMaxVideoBytes, readMultipart } from '../services/file'
import { normalizeCommentItems, normalizeComments, parseJsonComments } from '../services/normalize'
import { parseDouyinLink } from '../services/douyin'
import { buildPrompt } from '../services/prompt'
import { createAppError, isAppError, toApiError } from '../utils/errors'
import { createRequestId, failure, success } from '../utils/response'
import { parseBoolean, validateCount, validateMode, validatePromptLength, validateUrl, validateVideoFile } from '../utils/validators'

const MAX_ITEMS_PER_MODEL_CALL = 60

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
    let videoUrl = ''
    let dataUrl = ''

    if (mode === 'link') {
      const sourceUrl = validateUrl(field('url'))
      const parsed = await parseDouyinLink(sourceUrl, requestId)
      videoUrl = parsed.videoUrl!
    } else {
      const maxBytes = getMaxVideoBytes()
      const file = validateVideoFile(form.find((f) => f.name === 'video'), maxBytes, ALLOWED_VIDEO_MIME_TYPES)
      dataUrl = fileToBase64DataUrl(file.data!, file.type!)
    }

    // 4)~7) 分批调用模型（每次最多 60 条），直到补足需求
    const finalComments: string[] = []
    let rawTextCombined = ''
    let beforeNormalizeCount = 0
    let afterNormalizeCount = 0

    const maxRounds = Math.max(2, Math.ceil(count / MAX_ITEMS_PER_MODEL_CALL) + 2)

    for (let round = 1; round <= maxRounds; round += 1) {
      if (finalComments.length >= count) break

      const remaining = count - finalComments.length
      const roundTarget = Math.min(remaining, MAX_ITEMS_PER_MODEL_CALL)

      const prompt = buildPrompt({
        basePrompt: promptData.basePrompt,
        extraPrompt: [
          promptData.extraPrompt,
          `这是第 ${round} 轮生成，本轮最多输出 ${MAX_ITEMS_PER_MODEL_CALL} 条，达到后立即停止。`,
          finalComments.length ? '避免与前文重复评论。' : ''
        ].filter(Boolean).join('\n'),
        count: roundTarget,
        outputFormat
      })

      const aiResult = mode === 'link'
        ? await generateFromVideoUrl({
            model,
            prompt,
            videoUrl,
            requestId,
            fps: 1,
            stopAfterItems: MAX_ITEMS_PER_MODEL_CALL
          })
        : await generateFromVideoBase64({
            model,
            prompt,
            dataUrl,
            requestId,
            fps: 1,
            stopAfterItems: MAX_ITEMS_PER_MODEL_CALL
          })

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

      const roundComments = normalized.comments.slice(0, MAX_ITEMS_PER_MODEL_CALL)

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

      // 本轮没有新增，避免无意义重试
      if (finalComments.length === beforeLen) break
    }

    const trimmedComments = finalComments.slice(0, count)

    if (!trimmedComments.length) {
      throw createAppError({
        code: 'MODEL_OUTPUT_EMPTY',
        message: '结果格式异常，请重新生成',
        statusCode: 502
      })
    }

    if (trimmedComments.length < Math.ceil(count * 0.6)) {
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
