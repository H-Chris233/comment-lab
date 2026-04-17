import { promises as fs } from 'node:fs'
import path from 'node:path'
import { YtDlp } from 'ytdlp-nodejs'
import { fileToBase64DataUrl } from './file'
import { createAppError } from '../utils/errors'
import { validateUrl } from '../utils/validators'

const ALLOWED_DOUYIN_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com'])

function isAllowedDouyinHost(hostname: string) {
  if (ALLOWED_DOUYIN_HOSTS.has(hostname)) return true
  return hostname.endsWith('.douyin.com')
}

function assertDouyinUrl(url: string) {
  const validated = validateUrl(url)
  const parsed = new URL(validated)
  if (!isAllowedDouyinHost(parsed.hostname)) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '仅支持 douyin.com / v.douyin.com 链接',
      statusCode: 400
    })
  }
  return validated
}

function getTempDownloadDir() {
  const config = useRuntimeConfig()
  return config.tempVideoDir || path.join(process.cwd(), '.tmp', 'douyin-downloads')
}

function guessMimeByPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  return 'video/mp4'
}

export async function downloadDouyinVideoAsDataUrl(url: string, requestId: string) {
  const safeUrl = assertDouyinUrl(url)
  const dir = getTempDownloadDir()
  await fs.mkdir(dir, { recursive: true })

  const ytdlp = new YtDlp()

  let filePath = ''
  try {
    const result = await ytdlp
      .download(safeUrl)
      .output(dir)
      .type('mp4')
      .on('progress', () => {})
      .run()

    filePath = result.filePaths?.[0] || ''
    if (!filePath) {
      throw createAppError({
        code: 'VIDEO_FETCH_FAILED',
        message: '链接视频下载失败，请稍后重试',
        statusCode: 422
      })
    }

    const buffer = await fs.readFile(filePath)
    const mimeType = guessMimeByPath(filePath)
    const dataUrl = fileToBase64DataUrl(buffer, mimeType)

    console.info('[douyin.download]', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      outputFile: path.basename(filePath),
      sizeBytes: buffer.byteLength
    })

    return {
      dataUrl,
      sourcePath: filePath,
      cleanup: async () => {
        try {
          if (filePath) await fs.unlink(filePath)
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error

    console.error('[douyin.download] failed', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      message: error instanceof Error ? error.message : 'unknown'
    })

    throw createAppError({
      code: 'VIDEO_FETCH_FAILED',
      message: '链接视频下载失败，请稍后重试',
      statusCode: 422
    })
  }
}
