import path from 'node:path'

import { createAppError } from '../utils/errors'
import { runProcess } from './process-runner'

export type VideoProbeResult = {
  ok: true
  bytes: number
  format?: string
  duration?: string
  videoCodec?: string
  resolution?: string
  stderrPreview?: string
}

function ffmpegCommand() {
  return (process.env.FFMPEG_BINARY || 'ffmpeg').trim() || 'ffmpeg'
}

function preview(value: string, maxLength = 1200) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}

function parseFfmpegProbe(stderr: string) {
  const duration = stderr.match(/Duration:\s*([^,\s]+)/)?.[1]
  const videoLine = stderr.split(/\r?\n/).find((line) => /Stream #.*Video:/i.test(line))
  const videoCodec = videoLine?.match(/Video:\s*([^,\s]+)/i)?.[1]
  const resolution = videoLine?.match(/,\s*(\d{2,5}x\d{2,5})(?:[,\s]|$)/)?.[1]
  const format = stderr.match(/Input #0,\s*([^,\s]+)/)?.[1]

  return {
    duration,
    videoCodec,
    resolution,
    format
  }
}

export async function probeVideoFileForModel(params: {
  sourcePath: string
  bytes: number
  requestId?: string
  stepLabel: string
}): Promise<VideoProbeResult> {
  const command = ffmpegCommand()
  const basename = path.basename(params.sourcePath)

  console.info('[video-probe] start', {
    requestId: params.requestId,
    stepLabel: params.stepLabel,
    sourcePath: basename,
    bytes: params.bytes,
    command: path.basename(command)
  })

  try {
    const result = await runProcess({
      command,
      args: [
        '-hide_banner',
        '-i',
        params.sourcePath,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-'
      ]
    })
    const parsed = parseFfmpegProbe(result.stderr)
    const probeResult = {
      ok: true as const,
      bytes: params.bytes,
      ...parsed,
      stderrPreview: preview(result.stderr)
    }

    console.info('[video-probe] ok', {
      requestId: params.requestId,
      stepLabel: params.stepLabel,
      sourcePath: basename,
      bytes: params.bytes,
      format: probeResult.format,
      duration: probeResult.duration,
      videoCodec: probeResult.videoCodec,
      resolution: probeResult.resolution
    })
    return probeResult
  } catch (error) {
    const maybe = error as {
      code?: unknown
      stderr?: unknown
      message?: unknown
    }
    const stderr = typeof maybe.stderr === 'string' ? maybe.stderr : ''
    const message = error instanceof Error ? error.message : String(error)

    if (maybe.code === 'PROCESS_BINARY_MISSING') {
      console.warn('[video-probe] skipped-missing-ffmpeg', {
        requestId: params.requestId,
        stepLabel: params.stepLabel,
        sourcePath: basename,
        bytes: params.bytes,
        message
      })
      return {
        ok: true,
        bytes: params.bytes
      }
    }

    console.error('[video-probe] invalid', {
      requestId: params.requestId,
      stepLabel: params.stepLabel,
      sourcePath: basename,
      bytes: params.bytes,
      message,
      stderr: preview(stderr)
    })

    throw createAppError({
      code: 'VIDEO_INVALID',
      message: params.stepLabel === 'upload'
        ? '上传的视频文件不可解析，请换一个视频后重试'
        : '下载到的视频文件不可解析，请重试或改用本地上传',
      statusCode: 422,
      data: {
        sourcePath: basename,
        bytes: params.bytes,
        reason: preview(stderr || message)
      }
    })
  }
}
