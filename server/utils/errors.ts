export class AppError extends Error {
  code: string
  statusCode: number
  expose: boolean
  data?: Record<string, unknown>

  constructor(params: { code: string; message: string; statusCode: number; expose?: boolean; data?: Record<string, unknown> }) {
    super(params.message)
    this.name = 'AppError'
    this.code = params.code
    this.statusCode = params.statusCode
    this.expose = params.expose ?? true
    this.data = params.data
  }
}

export function createAppError(params: { code: string; message: string; statusCode: number; expose?: boolean; data?: Record<string, unknown> }) {
  return new AppError(params)
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

function isAppErrorLike(error: unknown): error is { code: string; statusCode: number; message: string; expose?: boolean } {
  if (!error || typeof error !== 'object') return false

  const maybe = error as Record<string, unknown>
  return typeof maybe.code === 'string' && typeof maybe.statusCode === 'number' && typeof maybe.message === 'string'
}

export function toApiError(error: unknown, requestId: string, fallback?: { code: string; message: string; statusCode?: number }) {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.expose ? error.message : (fallback?.message || '服务异常'),
      requestId,
      statusCode: error.statusCode,
      data: error.data
    }
  }

  if (isAppErrorLike(error)) {
    const maybe = error as { data?: unknown }
    const data = maybe.data && typeof maybe.data === 'object' ? maybe.data as Record<string, unknown> : undefined
    return {
      code: error.code,
      message: error.expose === false ? (fallback?.message || '服务异常') : error.message,
      requestId,
      statusCode: error.statusCode,
      data
    }
  }

  return {
    code: fallback?.code || 'INTERNAL_ERROR',
    message: fallback?.message || '服务异常',
    requestId,
    statusCode: fallback?.statusCode || 500
  }
}
