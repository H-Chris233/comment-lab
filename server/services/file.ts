import type { H3Event } from 'h3'
import { readMultipartFormData } from 'h3'
import { createAppError } from '../utils/errors'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const DEFAULT_DOWNLOADED_VIDEO_RETENTION_MINUTES = 10

export type UploadVideo = { type?: string; data?: Buffer; filename?: string }

export function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 500)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 500
  return Math.floor(mb * 1024 * 1024)
}

export function getMaxDownloadVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxDownloadVideoSizeMb || process.env.MAX_DOWNLOAD_VIDEO_SIZE_MB || 500)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 500
  return Math.floor(mb * 1024 * 1024)
}

function logVideoFetchProgress(params: {
  requestId?: string
  attempt: number
  downloadedBytes: number
  contentLength: number
  lastLoggedAt: number
  force?: boolean
}) {
  const now = Date.now()
  const shouldLogByTime = now - params.lastLoggedAt >= 5_000
  const shouldLogBySize = params.downloadedBytes > 0 && params.downloadedBytes % (5 * 1024 * 1024) === 0
  const shouldLog = params.force || shouldLogByTime || shouldLogBySize
  if (!shouldLog) return params.lastLoggedAt

  const percent = params.contentLength > 0
    ? Number(((params.downloadedBytes / params.contentLength) * 100).toFixed(1))
    : null

  console.info('[file.fetch-video] progress', {
    requestId: params.requestId,
    attempt: params.attempt,
    downloadedBytes: params.downloadedBytes,
    contentLength: params.contentLength || null,
    percent,
    complete: params.contentLength > 0 ? params.downloadedBytes >= params.contentLength : undefined
  })

  return now
}

function createClientAbortError() {
  return createAppError({
    code: 'CLIENT_ABORTED',
    message: '客户端已断开连接',
    statusCode: 499,
    expose: false
  })
}

function isAbortLikeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown')
  return /terminated|aborted|timeout|timed out|econnreset/i.test(message)
}

function wireAbortSignal(controller: AbortController, signal?: AbortSignal) {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }

  const onAbort = () => {
    controller.abort(signal.reason)
  }

  signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    signal.removeEventListener('abort', onAbort)
  }
}

async function fetchVideoBuffer(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
  retryTimes?: number
  signal?: AbortSignal
}) {
  const maxBytes = params.maxBytes ?? getMaxVideoBytes()
  const retryTimes = Math.max(1, params.retryTimes ?? 3)

  for (let attempt = 1; attempt <= retryTimes; attempt += 1) {
    const controller = new AbortController()
    const releaseAbort = wireAbortSignal(controller, params.signal)

    try {
      console.info('[file.fetch-video] start', {
        requestId: params.requestId,
        host: new URL(params.videoUrl).hostname,
        timeoutMs: params.timeoutMs ?? null,
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

      const contentLength = lenHeader > 0 ? lenHeader : 0
      console.info('[file.fetch-video] connected', {
        requestId: params.requestId,
        mime,
        contentLength: contentLength || null,
        attempt
      })

      let buffer: Buffer
      if (res.body?.getReader) {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let downloadedBytes = 0
        let lastLoggedAt = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.length) continue

          chunks.push(value)
          downloadedBytes += value.byteLength
          lastLoggedAt = logVideoFetchProgress({
            requestId: params.requestId,
            attempt,
            downloadedBytes,
            contentLength,
            lastLoggedAt
          })

          if (downloadedBytes > maxBytes) {
            await reader.cancel().catch(() => {})
            throw createAppError({
              code: 'FILE_TOO_LARGE',
              message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
              statusCode: 413
            })
          }
        }

        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        const merged = new Uint8Array(totalBytes)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }
        buffer = Buffer.from(merged)
        logVideoFetchProgress({
          requestId: params.requestId,
          attempt,
          downloadedBytes: buffer.byteLength,
          contentLength,
          lastLoggedAt,
          force: true
        })
      } else {
        const arrayBuffer = await res.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
      }

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
        contentLength: contentLength || null,
        attempt
      })

      return {
        mime,
        bytes: buffer.byteLength,
        buffer
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      const isFileTooLarge = error instanceof Error && (error as { code?: unknown }).code === 'FILE_TOO_LARGE'
      const isTerminal = isAbortLikeError(error)
      const isLastAttempt = attempt >= retryTimes

      console.error('[file.fetch-video] failed', {
        requestId: params.requestId,
        message,
        attempt,
        retryTimes,
        downloadedBytes: 0,
        isTerminal,
        isLastAttempt
      })

      if (isFileTooLarge) {
        throw error
      }

      if (params.signal?.aborted) {
        throw createClientAbortError()
      }

      if (!isLastAttempt) {
        const waitMs = attempt * 600
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        if (params.signal?.aborted) {
          throw createClientAbortError()
        }
        continue
      }

      if (isAbortLikeError(error)) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: '视频下载超时或连接中断，请重试',
          statusCode: 422
        })
      }

      throw error
    } finally {
      releaseAbort()
    }
  }

  throw createAppError({
    code: 'VIDEO_FETCH_FAILED',
    message: '视频下载失败，请稍后重试',
    statusCode: 422
  })
}

async function fetchVideoStreamToTempFile(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
  retryTimes?: number
  signal?: AbortSignal
}) {
  const maxBytes = params.maxBytes ?? getMaxVideoBytes()
  const retryTimes = Math.max(1, params.retryTimes ?? 3)

  for (let attempt = 1; attempt <= retryTimes; attempt += 1) {
    const controller = new AbortController()
    const releaseAbort = wireAbortSignal(controller, params.signal)
    let workDir = ''
    let filePath = ''

    try {
      console.info('[file.fetch-video] start', {
        requestId: params.requestId,
        host: new URL(params.videoUrl).hostname,
        timeoutMs: params.timeoutMs ?? null,
        maxBytes,
        attempt,
        retryTimes,
        streamToDisk: true
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

      const contentLength = lenHeader > 0 ? lenHeader : 0
      console.info('[file.fetch-video] connected', {
        requestId: params.requestId,
        mime,
        contentLength: contentLength || null,
        attempt,
        streamToDisk: true
      })

      workDir = path.join(getTempVideoDir(), `${Date.now()}-${randomUUID()}`)
      await fs.mkdir(workDir, { recursive: true })
      filePath = path.join(workDir, `video.${guessExtByMime(mime)}`)

      let downloadedBytes = 0
      let lastLoggedAt = 0
      const source = res.body

      if (!source) {
        const arrayBuffer = await res.arrayBuffer()
        downloadedBytes = arrayBuffer.byteLength
        if (downloadedBytes > maxBytes) {
          throw createAppError({
            code: 'FILE_TOO_LARGE',
            message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
            statusCode: 413
          })
        }
        await fs.writeFile(filePath, Buffer.from(arrayBuffer))
      } else if (typeof (source as any).getReader === 'function') {
        const reader = (source as any).getReader()
        const writer = createWriteStream(filePath)
        const writerClosed = new Promise<void>((resolve, reject) => {
          let settled = false
          const resolveOnce = () => {
            if (settled) return
            settled = true
            resolve()
          }
          const rejectOnce = (error: Error) => {
            if (settled) return
            settled = true
            reject(error)
          }

          writer.once('finish', resolveOnce)
          writer.once('close', resolveOnce)
          writer.once('error', rejectOnce)
        })

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value?.length) continue

            const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
            downloadedBytes += buffer.byteLength
            lastLoggedAt = logVideoFetchProgress({
              requestId: params.requestId,
              attempt,
              downloadedBytes,
              contentLength,
              lastLoggedAt
            })

            if (downloadedBytes > maxBytes) {
              await reader.cancel().catch(() => {})
              writer.destroy()
              throw createAppError({
                code: 'FILE_TOO_LARGE',
                message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
                statusCode: 413
              })
            }

            if (!writer.write(buffer)) {
              await once(writer, 'drain')
            }
          }

          writer.end()
          await writerClosed
        } catch (error) {
          writer.destroy()
          await writerClosed.catch(() => {})
          throw error
        }
      } else {
        const arrayBuffer = await res.arrayBuffer()
        downloadedBytes = arrayBuffer.byteLength
        if (downloadedBytes > maxBytes) {
          throw createAppError({
            code: 'FILE_TOO_LARGE',
            message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
            statusCode: 413
          })
        }
        await fs.writeFile(filePath, Buffer.from(arrayBuffer))
      }

      if (downloadedBytes === 0) {
        const fileStat = await fs.stat(filePath)
        downloadedBytes = fileStat.size
      }

      console.info('[file.fetch-video] success', {
        requestId: params.requestId,
        mime,
        bytes: downloadedBytes,
        contentLength: contentLength || null,
        attempt,
        streamToDisk: true
      })

      return {
        mime,
        bytes: downloadedBytes,
        sourcePath: filePath,
        cleanup: async () => {
          await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      const isFileTooLarge = error instanceof Error && (error as { code?: unknown }).code === 'FILE_TOO_LARGE'
      const isTerminal = isAbortLikeError(error)
      const isLastAttempt = attempt >= retryTimes

      console.error('[file.fetch-video] failed', {
        requestId: params.requestId,
        message,
        attempt,
        retryTimes,
        downloadedBytes: 0,
        isTerminal,
        isLastAttempt,
        streamToDisk: true
      })

      if (workDir) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
      }

      if (isFileTooLarge) {
        throw error
      }

      if (params.signal?.aborted) {
        throw createClientAbortError()
      }

      if (!isLastAttempt) {
        const waitMs = attempt * 600
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        if (params.signal?.aborted) {
          throw createClientAbortError()
        }
        continue
      }

      if (isAbortLikeError(error)) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: '视频下载超时或连接中断，请重试',
          statusCode: 422
        })
      }

      throw error
    } finally {
      releaseAbort()
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
  signal?: AbortSignal
  streamToDisk?: boolean
}) {
  if (params.streamToDisk) {
    return await fetchVideoStreamToTempFile(params)
  }

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
