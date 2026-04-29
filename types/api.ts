export interface ApiSuccess<T> {
  ok: true
  data: T
  requestId: string
}

export interface ApiError {
  ok: false
  code: string
  message: string
  requestId: string
  data?: Record<string, unknown>
}

export interface GenerateRequestPayload {
  mode: 'link' | 'upload'
  inputMode?: 'file' | 'base64'
  model?: string
  enableThinking?: boolean
  url?: string
  count: number
  basePrompt: string
  dedupe?: boolean
  cleanEmpty?: boolean
  timeoutMs?: number
}

export interface GenerateResultData {
  comments: string[]
  rawText: string
  promptTrace: string[]
  requestedCount: number
  finalCount: number
  beforeNormalizeCount: number
  afterNormalizeCount: number
  model: string
}

export type GenerateStatusPhase =
  | 'parsing'
  | 'downloading'
  | 'retrying'
  | 'compressing'
  | 'calling_model'
  | 'normalizing'
  | 'done'
  | 'failed'

export interface GenerateStatusData {
  requestId: string
  phase: GenerateStatusPhase
  message: string
  attempt?: number
  retryTimes?: number
  round?: number
  percent?: number | null
  downloadedBytes?: number
  contentLength?: number | null
  details?: Record<string, unknown>
}

export type GenerateResponse = ApiSuccess<GenerateResultData> | ApiError

export interface ParseLinkData {
  videoUrl: string
  title?: string
  cover?: string
}

export type ParseLinkResponse = ApiSuccess<ParseLinkData> | ApiError

export interface AuthStatusData {
  hasPassword: boolean
  authenticated: boolean
}

export type AuthStatusResponse = ApiSuccess<AuthStatusData> | ApiError

export interface AuthSubmitPayload {
  password: string
  confirmPassword?: string
}
