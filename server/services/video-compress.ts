import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getTempVideoDir as resolveTempVideoDir, toActionableStorageError } from './app-paths'

import type { GenerateStatusData } from '../../types/api'
import { createAppError } from '../utils/errors'
import { runProcess } from './process-runner'

const DEFAULT_MAX_COMPRESS_VIDEO_BYTES = 100 * 1024 * 1024

export interface CompressVideoIfNeededParams {
  sourcePath: string
  maxBytes?: number
  signal?: AbortSignal
  requestId?: string
  onStatus?: (status: GenerateStatusData) => void
}

export interface CompressVideoResult {
  sourcePath: string
  cleanup: () => Promise<void>
  bytes: number
  compressed: boolean
}

type CompressionProfile = {
  preset: string
  crf: number
}

const COMPRESSION_PROFILES: CompressionProfile[] = [
  { preset: 'veryfast', crf: 30 },
  { preset: 'slow', crf: 34 }
]

function getTempVideoDir() {
  return resolveTempVideoDir()
}

export function getMaxCompressVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxCompressVideoSizeMb || process.env.MAX_COMPRESS_VIDEO_SIZE_MB || 100)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 100
  return Math.floor(mb * 1024 * 1024)
}

function isAbortLikeError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const maybe = error as { name?: unknown; code?: unknown; message?: unknown }
  return maybe.name === 'AbortError'
    || maybe.code === 'PROCESS_ABORTED'
    || maybe.message === 'CLIENT_ABORTED'
    || /aborted/i.test(String(maybe.message || ''))
}

function isMissingBinaryError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'PROCESS_BINARY_MISSING')
}

function isExitError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'PROCESS_EXIT_NON_ZERO')
}

function createAbortAppError() {
  return createAppError({
    code: 'VIDEO_COMPRESS_ABORTED',
    message: '视频压缩已取消',
    statusCode: 499,
    expose: false
  })
}

function createCompressionAppError(message = '视频压缩失败，请重试') {
  return createAppError({
    code: 'VIDEO_COMPRESS_FAILED',
    message,
    statusCode: 422
  })
}

function createCompressionAppErrorWithData(message = '视频压缩失败，请重试', data?: Record<string, unknown>) {
  return createAppError({
    code: 'VIDEO_COMPRESS_FAILED',
    message,
    statusCode: 422,
    data
  })
}

function buildCompressionErrorData(error: unknown) {
  const runnerError = error as {
    exitCode?: unknown
    signal?: unknown
    stdout?: unknown
    stderr?: unknown
  }

  const detail: Record<string, unknown> = {}
  if (typeof runnerError.exitCode === 'number') detail.exitCode = runnerError.exitCode
  if (typeof runnerError.signal === 'string' || runnerError.signal === null) detail.signal = runnerError.signal
  if (typeof runnerError.stdout === 'string' && runnerError.stdout.trim()) detail.stdout = runnerError.stdout.trim()
  if (typeof runnerError.stderr === 'string' && runnerError.stderr.trim()) detail.stderr = runnerError.stderr.trim()
  return detail
}

function createMissingBinaryAppError() {
  return createAppError({
    code: 'VIDEO_COMPRESS_FFMPEG_MISSING',
    message: '未找到 ffmpeg，请先安装后重试',
    statusCode: 422
  })
}

async function cleanupWorkDir(workDir: string) {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
}

async function createTempWorkDir() {
  const root = getTempVideoDir()
  const workDir = path.join(root, `${Date.now()}-${randomUUID()}`)
  try {
    await fs.mkdir(workDir, { recursive: true })
    return workDir
  } catch (error) {
    const mapped = toActionableStorageError(error, 'TEMP_VIDEO_WRITE_FAILED', '无法创建本地视频工作目录')
    throw createAppError(mapped)
  }
}

function buildFfmpegArgs(params: {
  inputPath: string
  outputPath: string
  profile: CompressionProfile
}) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    params.inputPath,
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v',
    'libx264',
    '-preset',
    params.profile.preset,
    '-crf',
    String(params.profile.crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    params.outputPath
  ]
}

function emitCompressStatus(
  onStatus: CompressVideoIfNeededParams['onStatus'],
  payload: Omit<GenerateStatusData, 'requestId'> & { requestId?: string }
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

async function runCompressionAttempt(params: {
  inputPath: string
  outputPath: string
  profile: CompressionProfile
  signal?: AbortSignal
  requestId?: string
}) {
  const ffmpegCommand = (process.env.FFMPEG_BINARY || 'ffmpeg').trim() || 'ffmpeg'
  await runProcess({
    command: ffmpegCommand,
    args: buildFfmpegArgs({
      inputPath: params.inputPath,
      outputPath: params.outputPath,
      profile: params.profile
    }),
    signal: params.signal
  })

  return await fs.stat(params.outputPath)
}

async function compressVideoFile(params: {
  inputPath: string
  maxBytes: number
  signal?: AbortSignal
  requestId?: string
  onStatus?: CompressVideoIfNeededParams['onStatus']
}) {
  const workDir = await createTempWorkDir()
  const outputPath = path.join(workDir, 'compressed.mp4')

  console.info('[video-compress] start', {
    requestId: params.requestId,
    inputPath: path.basename(params.inputPath),
    maxBytes: params.maxBytes,
    profiles: COMPRESSION_PROFILES.map((profile) => `${profile.preset}@crf${profile.crf}`)
  })

  try {
    for (const [index, profile] of COMPRESSION_PROFILES.entries()) {
      emitCompressStatus(params.onStatus, {
        requestId: params.requestId,
        phase: 'compressing',
        message: `正在压缩视频（第 ${index + 1}/${COMPRESSION_PROFILES.length} 次尝试）`,
        attempt: index + 1,
        retryTimes: COMPRESSION_PROFILES.length,
        details: {
          preset: profile.preset,
          crf: profile.crf
        }
      })
      console.info('[video-compress] attempt:start', {
        requestId: params.requestId,
        attempt: index + 1,
        preset: profile.preset,
        crf: profile.crf,
        outputPath: path.basename(outputPath)
      })

      await fs.rm(outputPath, { force: true }).catch(() => {})

      let outputStat
      try {
        outputStat = await runCompressionAttempt({
          inputPath: params.inputPath,
          outputPath,
          profile,
          signal: params.signal,
          requestId: params.requestId
        })
      } catch (error) {
        if (isExitError(error)) {
          throw createCompressionAppErrorWithData('视频压缩失败，请重试', buildCompressionErrorData(error))
        }

        throw error
      }

      console.info('[video-compress] attempt:result', {
        requestId: params.requestId,
        attempt: index + 1,
        preset: profile.preset,
        crf: profile.crf,
        bytes: outputStat.size,
        maxBytes: params.maxBytes,
        compressed: outputStat.size <= params.maxBytes
      })

      if (outputStat.size <= params.maxBytes) {
        console.info('[video-compress] success', {
          requestId: params.requestId,
          bytes: outputStat.size,
          maxBytes: params.maxBytes,
          attempt: index + 1
        })
        emitCompressStatus(params.onStatus, {
          requestId: params.requestId,
          phase: 'compressing',
          message: '视频压缩完成',
          attempt: index + 1,
          retryTimes: COMPRESSION_PROFILES.length,
          downloadedBytes: outputStat.size,
          contentLength: outputStat.size,
          percent: 100
        })
        return {
          sourcePath: outputPath,
          cleanup: async () => {
            await cleanupWorkDir(workDir)
          },
          bytes: outputStat.size,
          compressed: true
        }
      }
    }

    console.warn('[video-compress] failed-over-limit', {
      requestId: params.requestId,
      maxBytes: params.maxBytes,
      attempts: COMPRESSION_PROFILES.length
    })
    emitCompressStatus(params.onStatus, {
      requestId: params.requestId,
      phase: 'failed',
      message: '压缩后视频仍然超过限制',
      attempt: COMPRESSION_PROFILES.length,
      retryTimes: COMPRESSION_PROFILES.length,
      details: {
        maxBytes: params.maxBytes
      }
    })
    throw createCompressionAppError(`压缩后视频仍然超过 ${Math.floor(params.maxBytes / 1024 / 1024)}MB`)
  } catch (error) {
    await cleanupWorkDir(workDir)

    if (!(error instanceof Error && (error as { code?: unknown }).code === 'VIDEO_COMPRESS_FAILED')) {
      console.warn('[video-compress] failed', {
        requestId: params.requestId,
        message: error instanceof Error ? error.message : 'unknown'
      })
    }

    if (isAbortLikeError(error)) {
      throw createAbortAppError()
    }

    if (isMissingBinaryError(error)) {
      throw createMissingBinaryAppError()
    }

    if (isExitError(error)) {
      throw createCompressionAppErrorWithData('视频压缩失败，请重试', buildCompressionErrorData(error))
    }

    if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'VIDEO_COMPRESS_FAILED') {
      throw error
    }

    throw createCompressionAppError()
  }
}

export async function compressVideoIfNeeded(params: CompressVideoIfNeededParams): Promise<CompressVideoResult> {
  const maxBytes = params.maxBytes ?? getMaxCompressVideoBytes() ?? DEFAULT_MAX_COMPRESS_VIDEO_BYTES

  if (params.signal?.aborted) {
    throw createAbortAppError()
  }

  let stat
  try {
    stat = await fs.stat(params.sourcePath)
  } catch {
    throw createCompressionAppError('视频文件不存在或无法读取')
  }

  if (params.signal?.aborted) {
    throw createAbortAppError()
  }

  if (stat.size <= maxBytes) {
    console.info('[video-compress] skip', {
      requestId: params.requestId,
      bytes: stat.size,
      maxBytes
    })
    return {
      sourcePath: params.sourcePath,
      cleanup: async () => {},
      bytes: stat.size,
      compressed: false
    }
  }

  console.info('[video-compress] required', {
    requestId: params.requestId,
    bytes: stat.size,
    maxBytes
  })

  emitCompressStatus(params.onStatus, {
    requestId: params.requestId,
    phase: 'compressing',
    message: '正在压缩视频',
    percent: null,
    downloadedBytes: stat.size,
    contentLength: stat.size,
    details: {
      maxBytes
    }
  })

  return await compressVideoFile({
    inputPath: params.sourcePath,
    maxBytes,
    signal: params.signal,
    requestId: params.requestId,
    onStatus: params.onStatus
  })
}

export const ensureVideoUnderLimit = compressVideoIfNeeded
