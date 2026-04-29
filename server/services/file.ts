import type { H3Event } from 'h3'
import { readMultipartFormData } from 'h3'
import { createAppError } from '../utils/errors'
import type { GenerateStatusData } from '../../types/api'
import { promises as fs } from 'node:fs'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
let tempVideoExitHookRegistered = false

export type UploadVideo = { type?: string; data?: Buffer; filename?: string }
type DownloadStatusEmitter = (status: GenerateStatusData) => void

function emitDownloadStatus(
  onStatus: DownloadStatusEmitter | undefined,
  payload: Omit<GenerateStatusData, 'requestId'>
  & { requestId?: string }
) {
  if (!onStatus || !payload.requestId) return
  onStatus({
    requestId: payload.requestId,
    phase: payload.phase,
    message: payload.message,
    attempt: payload.attempt,
    retryTimes: payload.retryTimes,
    round: payload.round,
    percent: payload.percent,
    downloadedBytes: payload.downloadedBytes,
    contentLength: payload.contentLength,
    details: payload.details
  })
}

export function formatDownloadRetryMessage(params: { attempt: number; retryTimes: number; percent: number | null }) {
  const base = `下载失败，正在重试（第 ${params.attempt}/${params.retryTimes} 次`
  if (params.percent == null) return `${base}）`
  return `${base}，已下载 ${params.percent}%）`
}

export function formatDownloadResumeMessage(params: { attempt: number; retryTimes: number; percent: number | null }) {
  const base = params.percent == null
    ? '下载中断，正在继续下载'
    : `下载中断，正在从 ${params.percent}% 继续下载`
  return `${base}（第 ${params.attempt}/${params.retryTimes} 次）`
}

export function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 1000)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 1000
  return Math.floor(mb * 1024 * 1024)
}

export function getMaxDownloadVideoBytes() {
  return Number.POSITIVE_INFINITY
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

function createRetryableDownloadError(params: {
  reason: string
  attempt: number
  retryTimes: number
}) {
  return createAppError({
    code: 'VIDEO_FETCH_FAILED',
    message: '视频下载失败，请稍后重试',
    statusCode: 422,
    data: {
      reason: params.reason,
      attempt: params.attempt,
      retryTimes: params.retryTimes
    }
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

function parseContentRangeTotal(contentRange: string | null) {
  if (!contentRange) return null
  const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i)
  if (!match) return null
  const total = Number(match[3])
  return Number.isFinite(total) && total > 0 ? total : null
}

async function getFileSize(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch {
    return 0
  }
}

async function fetchVideoBuffer(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
  retryTimes?: number
  signal?: AbortSignal
  onStatus?: DownloadStatusEmitter
}) {
  const maxBytes = params.maxBytes ?? Number.POSITIVE_INFINITY
  const retryTimes = Math.max(1, params.retryTimes ?? 3)

  for (let attempt = 1; attempt <= retryTimes; attempt += 1) {
    const controller = new AbortController()
    const releaseAbort = wireAbortSignal(controller, params.signal)
    let downloadedBytes = 0
    let contentLength = 0
    let lastPercent: number | null = null

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

      contentLength = lenHeader > 0 ? lenHeader : 0
      emitDownloadStatus(params.onStatus, {
        requestId: params.requestId,
        phase: 'downloading',
        message: '正在下载视频',
        attempt,
        retryTimes,
        downloadedBytes: 0,
        contentLength: contentLength || null,
        percent: null
      })
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
        let lastLoggedAt = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.length) continue

          chunks.push(value)
          downloadedBytes += value.byteLength
          lastPercent = contentLength > 0
            ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
            : null
          const previousLoggedAt = lastLoggedAt
          lastLoggedAt = logVideoFetchProgress({
            requestId: params.requestId,
            attempt,
            downloadedBytes,
            contentLength,
            lastLoggedAt
          })

          if (lastLoggedAt !== previousLoggedAt) {
            emitDownloadStatus(params.onStatus, {
              requestId: params.requestId,
              phase: 'downloading',
              message: lastPercent == null ? '正在下载视频' : `正在下载视频 ${lastPercent}%`,
              attempt,
              retryTimes,
              downloadedBytes,
              contentLength: contentLength || null,
              percent: lastPercent
            })
          }

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
        downloadedBytes = buffer.byteLength
        lastPercent = contentLength > 0
          ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
          : null
        logVideoFetchProgress({
          requestId: params.requestId,
          attempt,
          downloadedBytes,
          contentLength,
          lastLoggedAt,
          force: true
        })
      } else {
        const arrayBuffer = await res.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
        downloadedBytes = buffer.byteLength
        lastPercent = contentLength > 0
          ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
          : null
      }

      if (downloadedBytes > maxBytes) {
        throw createAppError({
          code: 'FILE_TOO_LARGE',
          message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
          statusCode: 413
        })
      }

      console.info('[file.fetch-video] success', {
        requestId: params.requestId,
        mime,
        bytes: downloadedBytes,
        contentLength: contentLength || null,
        attempt
      })

      emitDownloadStatus(params.onStatus, {
        requestId: params.requestId,
        phase: 'downloading',
        message: '视频下载完成',
        attempt,
        retryTimes,
        downloadedBytes,
        contentLength: contentLength || null,
        percent: 100
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
        emitDownloadStatus(params.onStatus, {
          requestId: params.requestId,
          phase: 'retrying',
          message: formatDownloadResumeMessage({
            attempt: attempt + 1,
            retryTimes,
            percent: lastPercent
          }),
          attempt: attempt + 1,
          retryTimes,
          details: {
            reason: message
          }
        })
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
          statusCode: 422,
          data: {
            reason: message,
            attempt,
            retryTimes
          }
        })
      }

      throw createRetryableDownloadError({
        reason: message,
        attempt,
        retryTimes
      })
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
  onStatus?: DownloadStatusEmitter
}) {
  const maxBytes = params.maxBytes ?? Number.POSITIVE_INFINITY
  const retryTimes = Math.max(1, params.retryTimes ?? 3)
  let workDir = ''
  let filePath = ''
  let mime = 'video/mp4'

  for (let attempt = 1; attempt <= retryTimes; attempt += 1) {
    const controller = new AbortController()
    const releaseAbort = wireAbortSignal(controller, params.signal)
    const resumeBytes = filePath ? await getFileSize(filePath) : 0
    let downloadedBytes = resumeBytes
    let contentLength = 0
    let lastPercent: number | null = null

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

      const requestHeaders: Record<string, string> = {
        'user-agent': 'Mozilla/5.0 (compatible; CommentLab/1.0)',
        referer: 'https://www.douyin.com/',
        origin: 'https://www.douyin.com'
      }
      if (resumeBytes > 0) {
        requestHeaders.Range = `bytes=${resumeBytes}-`
      }

      const res = await fetch(params.videoUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: requestHeaders
      })

      if (!res.ok) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: `视频下载失败（HTTP ${res.status}）`,
          statusCode: 422
        })
      }

      mime = res.headers.get('content-type')?.split(';')[0]?.trim() || mime
      const lenHeader = Number(res.headers.get('content-length') || '0')
      const contentRangeTotal = parseContentRangeTotal(res.headers.get('content-range'))
      const isPartialResponse = res.status === 206
      const responseTotalBytes = contentRangeTotal
        || (isPartialResponse && resumeBytes > 0 && lenHeader > 0 ? resumeBytes + lenHeader : 0)
        || lenHeader
        || 0
      const effectiveTotalBytes = isPartialResponse && resumeBytes > 0 && responseTotalBytes > 0
        ? Math.max(resumeBytes, responseTotalBytes)
        : responseTotalBytes

      if (effectiveTotalBytes > 0 && effectiveTotalBytes > maxBytes) {
        throw createAppError({
          code: 'FILE_TOO_LARGE',
          message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
          statusCode: 413
        })
      }

      contentLength = effectiveTotalBytes > 0 ? effectiveTotalBytes : 0

      if (!workDir) {
        workDir = path.join(getTempVideoDir(), `${Date.now()}-${randomUUID()}`)
        await fs.mkdir(workDir, { recursive: true })
      }
      if (!filePath) {
        filePath = path.join(workDir, `video.${guessExtByMime(mime)}`)
      }

      const canResume = resumeBytes > 0 && isPartialResponse
      if (!canResume && resumeBytes > 0) {
        downloadedBytes = 0
      }

      emitDownloadStatus(params.onStatus, {
        requestId: params.requestId,
        phase: 'downloading',
        message: canResume
          ? `正在继续下载视频${contentLength > 0 ? ` ${Math.min(100, Math.round((resumeBytes / contentLength) * 100))}%` : ''}`
          : '正在下载视频',
        attempt,
        retryTimes,
        downloadedBytes,
        contentLength: contentLength || null,
        percent: contentLength > 0 ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100)) : null
      })
      console.info('[file.fetch-video] connected', {
        requestId: params.requestId,
        mime,
        contentLength: contentLength || null,
        attempt,
        resumedFromBytes: resumeBytes > 0 ? resumeBytes : null,
        streamToDisk: true
      })

      let lastLoggedAt = 0
      const source = res.body

      if (!source) {
        const arrayBuffer = await res.arrayBuffer()
        const chunkBytes = arrayBuffer.byteLength
        downloadedBytes = (canResume ? resumeBytes : 0) + chunkBytes
        lastPercent = contentLength > 0
          ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
          : null
        if (downloadedBytes > maxBytes) {
          throw createAppError({
            code: 'FILE_TOO_LARGE',
            message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
            statusCode: 413
          })
        }
        if (canResume) {
          await fs.appendFile(filePath, Buffer.from(arrayBuffer))
        } else {
          await fs.writeFile(filePath, Buffer.from(arrayBuffer))
        }
      } else if (typeof (source as any).getReader === 'function') {
        const reader = (source as any).getReader()
        if (!canResume) {
          await fs.writeFile(filePath, '')
        }
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value?.length) continue

            const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
            downloadedBytes += buffer.byteLength
            lastPercent = contentLength > 0
              ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
              : null
            const previousLoggedAt = lastLoggedAt
            lastLoggedAt = logVideoFetchProgress({
              requestId: params.requestId,
              attempt,
              downloadedBytes,
              contentLength,
              lastLoggedAt
            })

            if (lastLoggedAt !== previousLoggedAt) {
              emitDownloadStatus(params.onStatus, {
                requestId: params.requestId,
                phase: 'downloading',
                message: lastPercent == null
                  ? '正在下载视频'
                  : `正在下载视频 ${lastPercent}%`,
                attempt,
                retryTimes,
                downloadedBytes,
                contentLength: contentLength || null,
                percent: lastPercent
              })
            }

            if (downloadedBytes > maxBytes) {
              await reader.cancel().catch(() => {})
              throw createAppError({
                code: 'FILE_TOO_LARGE',
                message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
                statusCode: 413
              })
            }

            await fs.appendFile(filePath, buffer)
          }
        } catch (error) {
          await reader.cancel().catch(() => {})
          throw error
        }
      } else {
        const arrayBuffer = await res.arrayBuffer()
        const chunkBytes = arrayBuffer.byteLength
        downloadedBytes = (canResume ? resumeBytes : 0) + chunkBytes
        if (downloadedBytes > maxBytes) {
          throw createAppError({
            code: 'FILE_TOO_LARGE',
            message: `视频大小超过限制（>${Math.floor(maxBytes / 1024 / 1024)}MB）`,
            statusCode: 413
          })
        }
        if (canResume) {
          await fs.appendFile(filePath, Buffer.from(arrayBuffer))
        } else {
          await fs.writeFile(filePath, Buffer.from(arrayBuffer))
        }
      }

      if (downloadedBytes === 0) {
        const fileStat = await fs.stat(filePath)
        downloadedBytes = fileStat.size
        lastPercent = contentLength > 0
          ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
          : null
      }

      console.info('[file.fetch-video] success', {
        requestId: params.requestId,
        mime,
        bytes: downloadedBytes,
        contentLength: contentLength || null,
        attempt,
        resumedFromBytes: resumeBytes > 0 ? resumeBytes : null,
        streamToDisk: true
      })

      emitDownloadStatus(params.onStatus, {
        requestId: params.requestId,
        phase: 'downloading',
        message: '视频下载完成',
        attempt,
        retryTimes,
        downloadedBytes,
        contentLength: contentLength || null,
        percent: 100
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
        downloadedBytes,
        isTerminal,
        isLastAttempt,
        streamToDisk: true
      })

      if (isFileTooLarge || params.signal?.aborted || isLastAttempt) {
        if (workDir) {
          await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      }

      if (isFileTooLarge) {
        throw error
      }

      if (params.signal?.aborted) {
        throw createClientAbortError()
      }

      if (!isLastAttempt) {
        emitDownloadStatus(params.onStatus, {
          requestId: params.requestId,
          phase: 'retrying',
          message: formatDownloadResumeMessage({
            attempt: attempt + 1,
            retryTimes,
            percent: lastPercent
          }),
          attempt: attempt + 1,
          retryTimes,
          details: {
            reason: message
          }
        })
        const waitMs = attempt * 600
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        if (params.signal?.aborted) {
          if (workDir) {
            await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
          }
          throw createClientAbortError()
        }
        continue
      }

      if (isAbortLikeError(error)) {
        throw createAppError({
          code: 'VIDEO_FETCH_FAILED',
          message: '视频下载超时或连接中断，请重试',
          statusCode: 422,
          data: {
            reason: message,
            attempt,
            retryTimes
          }
        })
      }

      throw createRetryableDownloadError({
        reason: message,
        attempt,
        retryTimes
      })
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

function cleanupTempVideoRootSync() {
  const root = getTempVideoDir()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on shutdown
  }
}

function ensureTempVideoExitCleanupHook() {
  if (tempVideoExitHookRegistered) return
  tempVideoExitHookRegistered = true

  process.once('beforeExit', cleanupTempVideoRootSync)
  process.once('exit', cleanupTempVideoRootSync)
}

async function writeVideoBufferToTempFile(
  buffer: Buffer,
  mime: string,
  requestId?: string
) {
  const root = getTempVideoDir()
  ensureTempVideoExitCleanupHook()
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
    bytes: buffer.byteLength,
    mime,
    cleanup: async () => {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
      console.info('[file.cache-video] cleaned', {
        requestId,
        workDir: path.basename(workDir)
      })
    }
  }
}

export async function downloadVideoUrlToTempFile(params: {
  videoUrl: string
  requestId?: string
  timeoutMs?: number
  maxBytes?: number
  retryTimes?: number
  signal?: AbortSignal
  streamToDisk?: boolean
  onStatus?: DownloadStatusEmitter
}) {
  if (params.streamToDisk) {
    return await fetchVideoStreamToTempFile(params)
  }

  const fetched = await fetchVideoBuffer(params)
  const { sourcePath, cleanup } = await writeVideoBufferToTempFile(fetched.buffer, fetched.mime, params.requestId)

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
