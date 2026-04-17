import type { ApiError, GenerateRequestPayload, GenerateResponse, ParseLinkResponse } from '~/types/api'

export function useGenerate() {
  const parsing = ref(false)
  const generating = ref(false)
  const error = ref('')
  const errorCode = ref('')

  const comments = ref<string[]>([])
  const rawText = ref('')
  const requestId = ref('')
  const requestedCount = ref(0)
  const finalCount = ref(0)
  const beforeNormalizeCount = ref(0)
  const afterNormalizeCount = ref(0)
  const model = ref('')

  const lastPayload = ref<GenerateRequestPayload & { file?: File | null } | null>(null)

  async function parseLink(url: string): Promise<ParseLinkResponse> {
    parsing.value = true
    try {
      return await $fetch<ParseLinkResponse>('/api/parse-link', {
        method: 'POST',
        body: { url }
      })
    } catch (e) {
      return {
        ok: false,
        code: 'PARSE_LINK_FAILED',
        message: e instanceof Error ? e.message : '链接解析失败，请改为上传视频',
        requestId: ''
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

    try {
      const form = new FormData()
      form.append('mode', payload.mode)
      if (payload.url) form.append('url', payload.url)
      if (payload.file) form.append('video', payload.file)
      form.append('count', String(payload.count))
      form.append('basePrompt', payload.basePrompt)
      form.append('extraPrompt', payload.extraPrompt || '')
      form.append('outputFormat', payload.outputFormat || 'text')
      form.append('dedupe', String(payload.dedupe ?? true))
      form.append('cleanEmpty', String(payload.cleanEmpty ?? true))

      const res = await $fetch<GenerateResponse>('/api/generate', {
        method: 'POST',
        body: form
      })

      requestId.value = res.requestId

      if (!res.ok) {
        error.value = res.message
        errorCode.value = res.code
        if (res.data?.rawText && typeof res.data.rawText === 'string') rawText.value = res.data.rawText
        return res
      }

      comments.value = res.data.comments
      rawText.value = res.data.rawText
      requestedCount.value = res.data.requestedCount
      finalCount.value = res.data.finalCount
      beforeNormalizeCount.value = res.data.beforeNormalizeCount
      afterNormalizeCount.value = res.data.afterNormalizeCount
      model.value = res.data.model
      lastPayload.value = payload

      return res
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成失败'
      error.value = message
      errorCode.value = 'MODEL_CALL_FAILED'
      comments.value = []
      rawText.value = ''
      return {
        ok: false,
        code: errorCode.value,
        message,
        requestId: requestId.value
      }
    } finally {
      generating.value = false
    }
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
    requestId,
    requestedCount,
    finalCount,
    beforeNormalizeCount,
    afterNormalizeCount,
    model,
    parseLink,
    generate,
    regenerate
  }
}
