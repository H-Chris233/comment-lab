import type { H3Event } from 'h3'
import { createAppError } from '../utils/errors'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export type UploadVideo = { type?: string; data?: Buffer; filename?: string }

export function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 100)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 100
  return Math.floor(mb * 1024 * 1024)
}

export function fileToBase64DataUrl(fileBuffer: Buffer, mimeType: string) {
  const base64 = fileBuffer.toString('base64')
  return `data:${mimeType};base64,${base64}`
}

export async function readMultipart(event: H3Event) {
  const form = await readMultipartFormData(event)
  if (!form?.length) {
    return []
  }
  return form
}

export async function fetchVideoUrlAsDataUrl(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
  retryTimes?: number
}) {
  const timeoutMs = params.timeoutMs ?? 60_000
  const maxBytes = params.maxBytes ?? getMaxVideoBytes()
  const retryTimes = Math.max(1, params.retryTimes ?? 3)

  for (let attempt = 1; attempt <= retryTimes; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      console.info('[file.fetch-video] start', {
        requestId: params.requestId,
        host: new URL(params.videoUrl).hostname,
        timeoutMs,
        maxBytes,
        attempt,
        retryTimes
      })

      const res = await fetch(params.videoUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; CommentLab/1.0)',
          referer: 'https://www.douyin.com/',
          origin: 'https://www.douyin.com'
        }
      })

      if (!res.ok) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: `视频下载失败（HTTP ${res.status}）`,
          statusCode: 422
        })
      }

      const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4'
      const lenHeader = Number(res.headers.get('content-length') || '0')
      if (lenHeader > 0 && lenHeader > maxBytes) {
        throw createAppError({
          code: 'FILE_TOO_LARGE',
          message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
          statusCode: 413
        })
      }

      const arrayBuffer = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (buffer.byteLength > maxBytes) {
        throw createAppError({
          code: 'FILE_TOO_LARGE',
          message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
          statusCode: 413
        })
      }

      const dataUrl = fileToBase64DataUrl(buffer, mime)
      console.info('[file.fetch-video] success', {
        requestId: params.requestId,
        mime,
        bytes: buffer.byteLength,
        attempt
      })

      return {
        dataUrl,
        mime,
        bytes: buffer.byteLength
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      const isTerminal = error instanceof Error && /terminated|aborted|timeout|timed out|econnreset/i.test(message)
      const isLastAttempt = attempt >= retryTimes

      console.error('[file.fetch-video] failed', {
        requestId: params.requestId,
        message,
        attempt,
        retryTimes,
        isTerminal,
        isLastAttempt
      })

      if (!isLastAttempt) {
        const waitMs = attempt * 600
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }

      if (error instanceof Error && /terminated|aborted|timeout|timed out|econnreset/i.test(message)) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: '视频下载超时或连接中断，请重试',
          statusCode: 422
        })
      }

      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  throw createAppError({
    code: 'VIDEO_FETCH_FAILED',
    message: '视频下载失败，请稍后重试',
    statusCode: 422
  })
}

function guessExtByMime(mime: string) {
  if (mime === 'video/webm') return 'webm'
  if (mime === 'video/quicktime') return 'mov'
  return 'mp4'
}

function getTempVideoDir() {
  const config = useRuntimeConfig()
  return config.tempVideoDir || path.join(process.cwd(), '.tmp', 'video-cache')
}

export async function downloadVideoUrlAsDataUrl(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
}) {
  const fetched = await fetchVideoUrlAsDataUrl(params)
  const root = getTempVideoDir()
  const workDir = path.join(root, `${Date.now()}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const filePath = path.join(workDir, `video.${guessExtByMime(fetched.mime)}`)
  const base64 = fetched.dataUrl.split(',')[1] || ''
  const buffer = Buffer.from(base64, 'base64')
  await fs.writeFile(filePath, buffer)

  console.info('[file.cache-video] saved', {
    requestId: params.requestId,
    filePath: path.basename(filePath),
    bytes: buffer.byteLength
  })

  return {
    dataUrl: fetched.dataUrl,
    bytes: fetched.bytes,
    mime: fetched.mime,
    sourcePath: filePath,
    cleanup: async () => {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
      console.info('[file.cache-video] cleaned', {
        requestId: params.requestId,
        workDir: path.basename(workDir)
      })
    }
  }
}
