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

  function toApiErrorLike(error: unknown): ApiError {
    const fallback: ApiError = {
      ok: false,
      code: 'NETWORK_ERROR',
      message: '请求失败，请检查网络后重试',
      requestId: requestId.value
    }

    if (!error || typeof error !== 'object') return fallback

    const e = error as {
      data?: Partial<ApiError>
      response?: { _data?: Partial<ApiError> }
      status?: number
      statusCode?: number
      message?: string
    }

    const payload = e.data || e.response?._data
    if (payload?.ok === false && payload.code && payload.message) {
      return {
        ok: false,
        code: payload.code,
        message: payload.message,
        requestId: payload.requestId || requestId.value,
        data: payload.data
      }
    }

    const status = e.statusCode || e.status
    if (status === 504 || status === 524) {
      return {
        ok: false,
        code: 'REQUEST_TIMEOUT',
        message: '请求超时（后端可能仍在处理中），请稍后重试并减少生成数量',
        requestId: requestId.value
      }
    }

    const msg = e.message || ''
    if (/aborted|timeout|timed out|fetch failed|network/i.test(msg)) {
      return {
        ok: false,
        code: 'REQUEST_TIMEOUT',
        message: '请求超时或网络中断，请重试',
        requestId: requestId.value
      }
    }

    return {
      ok: false,
      code: fallback.code,
      message: fallback.message,
      requestId: requestId.value
    }
  }

  async function parseLink(url: string): Promise<ParseLinkResponse> {
    parsing.value = true
    try {
      return await $fetch<ParseLinkResponse>('/api/parse-link', {
        method: 'POST',
        body: { url }
      })
    } catch (e) {
      const mapped = toApiErrorLike(e)
      return {
        ok: false,
        code: mapped.code || 'PARSE_LINK_FAILED',
        message: mapped.message || '链接解析失败，请稍后重试',
        requestId: mapped.requestId || ''
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
      const mapped = toApiErrorLike(e)
      error.value = mapped.message
      errorCode.value = mapped.code
      comments.value = []
      rawText.value = ''
      return {
        ok: false,
        code: errorCode.value,
        message: error.value,
        requestId: mapped.requestId || requestId.value
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
