import type { H3Event } from 'h3'
import { readMultipartFormData } from 'h3'
import { createAppError } from '../utils/errors'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const DEFAULT_DOWNLOADED_VIDEO_RETENTION_MINUTES = 10

export type UploadVideo = { type?: string; data?: Buffer; filename?: string }

export function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 100)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 100
  return Math.floor(mb * 1024 * 1024)
}

async function fetchVideoBuffer(params: {
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

      console.info('[file.fetch-video] success', {
        requestId: params.requestId,
        mime,
        bytes: buffer.byteLength,
        attempt
      })

      return {
        mime,
        bytes: buffer.byteLength,
        buffer
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

export async function readMultipart(event: H3Event) {
  const form = await readMultipartFormData(event)
  if (!form?.length) {
    return []
  }
  return form
}

function guessExtByMime(mime: string) {
  if (mime === 'video/webm') return 'webm'
  if (mime === 'video/quicktime') return 'mov'
  return 'mp4'
}

function getTempVideoDir() {
  const config = useRuntimeConfig()
  const configured = config.tempVideoDir || path.join(process.cwd(), '.tmp', 'video-cache')
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

function getDownloadedVideoRetentionMs() {
  const config = useRuntimeConfig()
  const fromConfig = Number(
    config.tempVideoRetentionMinutes || process.env.TEMP_VIDEO_RETENTION_MINUTES || DEFAULT_DOWNLOADED_VIDEO_RETENTION_MINUTES
  )
  const minutes = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : DEFAULT_DOWNLOADED_VIDEO_RETENTION_MINUTES
  return Math.floor(minutes * 60 * 1000)
}

async function writeVideoBufferToTempFile(
  buffer: Buffer,
  mime: string,
  requestId?: string,
  options?: { cleanupDelayMs?: number }
) {
  const root = getTempVideoDir()
  const workDir = path.join(root, `${Date.now()}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const filePath = path.join(workDir, `video.${guessExtByMime(mime)}`)
  await fs.writeFile(filePath, buffer)

  console.info('[file.cache-video] saved', {
    requestId,
    filePath: path.basename(filePath),
    bytes: buffer.byteLength
  })

  return {
    sourcePath: filePath,
    cleanup: async () => {
      const cleanupDelayMs = Math.max(0, options?.cleanupDelayMs ?? 0)

      if (cleanupDelayMs === 0) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
        console.info('[file.cache-video] cleaned', {
          requestId,
          workDir: path.basename(workDir)
        })
        return
      }

      const timer = setTimeout(() => {
        void fs.rm(workDir, { recursive: true, force: true })
          .then(() => {
            console.info('[file.cache-video] cleaned', {
              requestId,
              workDir: path.basename(workDir),
              delayMs: cleanupDelayMs
            })
          })
          .catch(() => {})
      }, cleanupDelayMs)
      timer.unref?.()
      console.info('[file.cache-video] cleanup scheduled', {
        requestId,
        workDir: path.basename(workDir),
        delayMs: cleanupDelayMs
      })
    }
  }
}

export async function downloadVideoUrlToTempFile(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
}) {
  const fetched = await fetchVideoBuffer(params)
  const { sourcePath, cleanup } = await writeVideoBufferToTempFile(fetched.buffer, fetched.mime, params.requestId, {
    cleanupDelayMs: getDownloadedVideoRetentionMs()
  })

  return {
    bytes: fetched.bytes,
    mime: fetched.mime,
    sourcePath,
    cleanup
  }
}

export async function saveVideoUploadToTempFile(file: UploadVideo, requestId?: string) {
  if (!file.data || !file.type) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '请上传视频文件',
      statusCode: 400
    })
  }

  return writeVideoBufferToTempFile(file.data, file.type, requestId)
}
