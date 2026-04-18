import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileToBase64DataUrl } from './file'
import { createAppError } from '../utils/errors'
import { validateUrl } from '../utils/validators'

const ALLOWED_DOUYIN_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v'])

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

function runDydlDownload(url: string, outputDir: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const bin = getDydlBin()
    const args = ['video', '-d', outputDir, '--no-subfolders', url]

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error(stderr || stdout || `dydl exited with ${code}`))
    })
  })
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full))
    } else {
      files.push(full)
    }
  }

  return files
}

function guessMimeByExt(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  return 'video/mp4'
}

async function pickDownloadedVideoFile(workDir: string) {
  const files = await collectFiles(workDir)
  const candidates = files.filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))

  if (!candidates.length) return null

  const withStat = await Promise.all(
    candidates.map(async (f) => ({ file: f, mtime: (await fs.stat(f)).mtimeMs }))
  )

  withStat.sort((a, b) => b.mtime - a.mtime)
  return withStat[0]?.file || null
}

export async function downloadDouyinVideoAsDataUrl(url: string, requestId: string) {
  const safeUrl = assertDouyinUrl(url)

  const rootDir = getTempDownloadDir()
  const workDir = path.join(rootDir, `${Date.now()}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  let chosenFile = ''

  try {
    const runResult = await runDydlDownload(safeUrl, workDir)

    const found = await pickDownloadedVideoFile(workDir)
    if (!found) {
      const outputHint = runResult.stdout || runResult.stderr || ''
      throw new Error(`download finished but no video file found; output=${outputHint.slice(0, 280)}`)
    }

    chosenFile = found

    const buffer = await fs.readFile(chosenFile)
    const dataUrl = fileToBase64DataUrl(buffer, guessMimeByExt(chosenFile))

    console.info('[douyin.download]', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      outputFile: path.basename(chosenFile),
      sizeBytes: buffer.byteLength,
      engine: 'douyin-downloader'
    })

    return {
      dataUrl,
      sourcePath: chosenFile,
      cleanup: async () => {
        try {
          await fs.rm(workDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})

    console.error('[douyin.download] failed', {
      requestId,
      sourceHost: new URL(safeUrl).hostname,
      message: error instanceof Error ? error.message : 'unknown',
      outputFile: chosenFile ? path.basename(chosenFile) : undefined,
      engine: 'douyin-downloader'
    })

    throw createAppError({
      code: 'VIDEO_FETCH_FAILED',
      message: '链接视频下载失败，请稍后重试或改为上传视频',
      statusCode: 422
    })
  }
}
