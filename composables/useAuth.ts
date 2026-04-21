import { computed, ref } from 'vue'
import type { ApiError, AuthStatusData, AuthStatusResponse, AuthSubmitPayload } from '~/types/api'

function toApiErrorLike(error: unknown): ApiError {
  const fallback: ApiError = {
    ok: false,
    code: 'NETWORK_ERROR',
    message: '请求失败，请检查网络后重试',
    requestId: ''
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
      requestId: payload.requestId || '',
      data: payload.data
    }
  }

  const status = e.statusCode || e.status
  if (status === 401) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: '请先输入密码解锁',
      requestId: ''
    }
  }

  return fallback
}

export function useAuth() {
  const loading = ref(false)
  const error = ref('')
  const errorCode = ref('')
  const status = ref<AuthStatusData>({ hasPassword: false, authenticated: false })
  const initialized = ref(false)

  const hasPassword = computed(() => status.value.hasPassword)
  const authenticated = computed(() => status.value.authenticated)
  const unlocked = computed(() => status.value.hasPassword && status.value.authenticated)
  const ready = computed(() => initialized.value)

  async function loadStatus() {
    loading.value = true
    error.value = ''
    errorCode.value = ''
    try {
      const res = await $fetch<AuthStatusResponse>('/api/auth/status')
      if (!res.ok) {
        error.value = res.message
        errorCode.value = res.code
        return status.value
      }

      status.value = res.data
      return status.value
    } catch (e) {
      const mapped = toApiErrorLike(e)
      error.value = mapped.message
      errorCode.value = mapped.code
      return status.value
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function submit(endpoint: 'login' | 'set-password' | 'change-password', payload: AuthSubmitPayload) {
    loading.value = true
    error.value = ''
    errorCode.value = ''

    try {
      const res = await $fetch<AuthStatusResponse>(`/api/auth/${endpoint}`, {
        method: 'POST',
        body: payload
      })

      if (!res.ok) {
        error.value = res.message
        errorCode.value = res.code
        return res
      }

      status.value = res.data
      return res
    } catch (e) {
      const mapped = toApiErrorLike(e)
      error.value = mapped.message
      errorCode.value = mapped.code
      return mapped
    } finally {
      loading.value = false
    }
  }

  async function login(password: string) {
    return submit('login', { password })
  }

  async function setPassword(password: string, confirmPassword?: string) {
    return submit('set-password', { password, confirmPassword })
  }

  async function changePassword(password: string, confirmPassword?: string) {
    return submit('change-password', { password, confirmPassword })
  }

  async function logout() {
    loading.value = true
    error.value = ''
    errorCode.value = ''

    try {
      const res = await $fetch<AuthStatusResponse>('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        status.value = res.data
      }
      return res
    } catch (e) {
      const mapped = toApiErrorLike(e)
      error.value = mapped.message
      errorCode.value = mapped.code
      return mapped
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    errorCode,
    status,
    hasPassword,
    authenticated,
    unlocked,
    ready,
    initialized,
    loadStatus,
    login,
    setPassword,
    changePassword,
    logout
  }
}
