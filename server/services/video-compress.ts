import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { createAppError } from '../utils/errors'
import { runProcess } from './process-runner'

const DEFAULT_MAX_COMPRESS_VIDEO_BYTES = 100 * 1024 * 1024

export interface CompressVideoIfNeededParams {
  sourcePath: string
  maxBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  requestId?: string
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
  const config = useRuntimeConfig()
  const configured = config.tempVideoDir || path.join(process.cwd(), '.tmp', 'video-cache')
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
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
    || maybe.code === 'PROCESS_TIMEOUT'
    || maybe.message === 'CLIENT_ABORTED'
    || maybe.message === 'REQUEST_TIMEOUT'
    || /aborted|timeout|timed out/i.test(String(maybe.message || ''))
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
  await fs.mkdir(workDir, { recursive: true })
  return workDir
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
    'scale=1280:720:force_original_aspect_ratio=decrease',
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

async function runCompressionAttempt(params: {
  inputPath: string
  outputPath: string
  profile: CompressionProfile
  signal?: AbortSignal
  timeoutMs?: number
  requestId?: string
}) {
  await runProcess({
    command: 'ffmpeg',
    args: buildFfmpegArgs({
      inputPath: params.inputPath,
      outputPath: params.outputPath,
      profile: params.profile
    }),
    signal: params.signal,
    timeoutMs: params.timeoutMs
  })

  return await fs.stat(params.outputPath)
}

async function compressVideoFile(params: {
  inputPath: string
  maxBytes: number
  signal?: AbortSignal
  timeoutMs?: number
  requestId?: string
}) {
  const workDir = await createTempWorkDir()
  const outputPath = path.join(workDir, 'compressed.mp4')

  console.info('[video-compress] start', {
    requestId: params.requestId,
    inputPath: path.basename(params.inputPath),
    maxBytes: params.maxBytes,
    timeoutMs: params.timeoutMs ?? null,
    profiles: COMPRESSION_PROFILES.map((profile) => `${profile.preset}@crf${profile.crf}`)
  })

  try {
    for (const [index, profile] of COMPRESSION_PROFILES.entries()) {
      console.info('[video-compress] attempt:start', {
        requestId: params.requestId,
        attempt: index + 1,
        preset: profile.preset,
        crf: profile.crf,
        outputPath: path.basename(outputPath)
      })

      await fs.rm(outputPath, { force: true }).catch(() => {})

      const outputStat = await runCompressionAttempt({
        inputPath: params.inputPath,
        outputPath,
        profile,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
        requestId: params.requestId
      })

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
      throw createCompressionAppError()
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

  return await compressVideoFile({
    inputPath: params.sourcePath,
    maxBytes,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    requestId: params.requestId
  })
}

export const ensureVideoUnderLimit = compressVideoIfNeeded
