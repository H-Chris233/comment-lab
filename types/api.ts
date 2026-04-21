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
  includeCommentSamples?: boolean
  url?: string
  count: number
  basePrompt: string
  dedupe?: boolean
  cleanEmpty?: boolean
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

export type GenerateResponse = ApiSuccess<GenerateResultData> | ApiError

export interface ParseLinkData {
  videoUrl: string
  title?: string
  cover?: string
}

export type ParseLinkResponse = ApiSuccess<ParseLinkData> | ApiError
