import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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

function getDydlBin() {
  return path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'dydl.cmd' : 'dydl')
}

function runDydlDownload(url: string, outputDir: string, filename: string) {
  return new Promise<void>((resolve, reject) => {
    const bin = getDydlBin()
    const args = ['video', '-d', outputDir, '-f', filename, url]

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(stderr || `dydl exited with ${code}`))
    })
  })
}

export async function downloadDouyinVideoAsDataUrl(url: string, requestId: string) {
  const safeUrl = assertDouyinUrl(url)
  const dir = getTempDownloadDir()
  await fs.mkdir(dir, { recursive: true })

  const filename = `${Date.now()}-${randomUUID()}.mp4`
  const filePath = path.join(dir, filename)

  try {
    await runDydlDownload(safeUrl, dir, filename)

    const buffer = await fs.readFile(filePath)
    const dataUrl = fileToBase64DataUrl(buffer, 'video/mp4')

    console.info('[douyin.download]', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      outputFile: filename,
      sizeBytes: buffer.byteLength,
      engine: 'douyin-downloader'
    })

    return {
      dataUrl,
      sourcePath: filePath,
      cleanup: async () => {
        try {
          await fs.unlink(filePath)
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    console.error('[douyin.download] failed', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      message: error instanceof Error ? error.message : 'unknown',
      engine: 'douyin-downloader'
    })

    throw createAppError({
      code: 'VIDEO_FETCH_FAILED',
      message: '链接视频下载失败，请稍后重试或改为上传视频',
      statusCode: 422
    })
  }
}
