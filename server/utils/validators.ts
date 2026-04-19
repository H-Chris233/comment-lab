import type { UploadVideo } from '../services/file'
import { createAppError } from './errors'

export function parseBoolean(value?: string) {
  return value === 'true' || value === '1'
}

export function validateMode(mode?: string): 'link' | 'upload' {
  if (mode !== 'link' && mode !== 'upload') {
    throw createAppError({ code: 'INVALID_INPUT', message: 'mode 必须是 link 或 upload', statusCode: 400 })
  }
  return mode
}

export function validateCount(raw?: string): number {
  const count = Number(raw)
  if (!Number.isFinite(count)) {
    throw createAppError({ code: 'INVALID_INPUT', message: '生成数量非法', statusCode: 400 })
  }

  const intCount = Math.floor(count)
  const preset = [180, 360, 540, 720]

  if (preset.includes(intCount)) return intCount

  if (intCount < 1 || intCount > 1500) {
    throw createAppError({ code: 'INVALID_INPUT', message: '自定义数量范围为 1~1500', statusCode: 400 })
  }

  return intCount
}

export function validatePromptLength(basePrompt?: string, extraPrompt?: string) {
  const base = basePrompt?.trim() || ''
  const extra = extraPrompt?.trim() || ''

  if (!base) {
    throw createAppError({ code: 'INVALID_INPUT', message: '默认提示词不能为空', statusCode: 400 })
  }

  if (base.length > 6000) {
    throw createAppError({ code: 'INVALID_INPUT', message: '默认提示词不能超过 6000 字符', statusCode: 400 })
  }

  if (extra.length > 2000) {
    throw createAppError({ code: 'INVALID_INPUT', message: '附加要求不能超过 2000 字符', statusCode: 400 })
  }

  return {
    basePrompt: base,
    extraPrompt: extra
  }
}

function extractHttpUrls(input: string) {
  const matches = input.match(/https?:\/\/[^\s]+/gi) || []
  return matches.map((raw) => raw.replace(/[)\]}>」』】）。，！？、;；]+$/g, ''))
}

export function validateUrl(url?: string): string {
  const value = url?.trim()
  if (!value) {
    throw createAppError({ code: 'INVALID_INPUT', message: '链接不能为空', statusCode: 400 })
  }

  const urls = extractHttpUrls(value)

  if (urls.length > 1) {
    throw createAppError({ code: 'INVALID_INPUT', message: '一次仅支持粘贴一个链接', statusCode: 400 })
  }

  const candidate = urls[0] || value

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw createAppError({ code: 'INVALID_INPUT', message: '链接格式不正确', statusCode: 400 })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createAppError({ code: 'INVALID_INPUT', message: '仅支持 http/https 链接', statusCode: 400 })
  }

  return parsed.toString()
}

export function isHttpUrl(value?: string) {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateVideoFile(
  file: UploadVideo | undefined,
  maxBytes: number,
  allowedMimeTypes: string[]
): UploadVideo {
  if (!file?.data) {
    throw createAppError({ code: 'INVALID_INPUT', message: '请上传视频文件', statusCode: 400 })
  }

  if (!file.type || !allowedMimeTypes.includes(file.type)) {
    throw createAppError({ code: 'INVALID_FILE_TYPE', message: '仅支持 mp4/mov/webm 格式', statusCode: 400 })
  }

  if (file.data.byteLength > maxBytes) {
    throw createAppError({ code: 'FILE_TOO_LARGE', message: '文件大小不能超过限制', statusCode: 413 })
  }

  return file
}
