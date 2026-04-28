import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { createAppError } from '../utils/errors'
import { runProcess } from './process-runner'

const DEFAULT_MAX_VIDEO_BYTES = 100 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

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

function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 100)
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
    timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS
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

  try {
    for (const profile of COMPRESSION_PROFILES) {
      await fs.rm(outputPath, { force: true }).catch(() => {})

      const outputStat = await runCompressionAttempt({
        inputPath: params.inputPath,
        outputPath,
        profile,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
        requestId: params.requestId
      })

      if (outputStat.size <= params.maxBytes) {
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

    throw createCompressionAppError(`压缩后视频仍然超过 ${Math.floor(params.maxBytes / 1024 / 1024)}MB`)
  } catch (error) {
    await cleanupWorkDir(workDir)

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
  const maxBytes = params.maxBytes ?? getMaxVideoBytes() ?? DEFAULT_MAX_VIDEO_BYTES

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
    return {
      sourcePath: params.sourcePath,
      cleanup: async () => {},
      bytes: stat.size,
      compressed: false
    }
  }

  return await compressVideoFile({
    inputPath: params.sourcePath,
    maxBytes,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    requestId: params.requestId
  })
}

export const ensureVideoUnderLimit = compressVideoIfNeeded
