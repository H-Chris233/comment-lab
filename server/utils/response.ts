import type { ApiError, ApiSuccess } from '../../types/api'
import { randomUUID } from 'node:crypto'

export function createRequestId() {
  return `req_${Date.now()}_${randomUUID().slice(0, 8)}`
}

export function success<T>(data: T, requestId: string): ApiSuccess<T> {
  return { ok: true, data, requestId }
}

export function failure(params: { code: string; message: string; requestId: string; data?: Record<string, unknown> }): ApiError {
  return {
    ok: false,
    code: params.code,
    message: params.message,
    requestId: params.requestId,
    data: params.data
  }
}
