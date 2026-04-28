import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compressVideoIfNeeded } from '../../server/services/video-compress'
import { runProcess } from '../../server/services/process-runner'

vi.mock('../../server/services/process-runner', () => ({
  runProcess: vi.fn()
}))

const MB = 1024 * 1024
const MAX_BYTES = 100 * MB
const TEST_ROOT = path.join(process.cwd(), '.tmp', 'video-compress-tests')
const TEMP_VIDEO_CACHE_ROOT = path.resolve(process.cwd(), '.tmp', 'video-cache')

async function createSparseVideoFile(bytes: number, filename = 'input.mp4') {
  const workDir = path.join(TEST_ROOT, randomUUID())
  await fs.mkdir(workDir, { recursive: true })

  const filePath = path.join(workDir, filename)
  await fs.writeFile(filePath, Buffer.from([1]))
  await fs.truncate(filePath, bytes)

  return filePath
}

describe('compressVideoIfNeeded', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tempVideoDir: path.join('.tmp', 'video-cache'),
      maxVideoSizeMb: 500,
      maxCompressVideoSizeMb: 100
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await fs.rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {})
    await fs.rm(TEMP_VIDEO_CACHE_ROOT, { recursive: true, force: true }).catch(() => {})
  })

  it('keeps files at or below 100MB unchanged', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES)

    const result = await compressVideoIfNeeded({ sourcePath })

    expect(result.sourcePath).toBe(sourcePath)
    expect(result.bytes).toBe(MAX_BYTES)
    expect(result.compressed).toBe(false)
    expect(vi.mocked(runProcess)).not.toHaveBeenCalled()

    await result.cleanup()
  })

  it('compresses files above 100MB into a new temp mp4 path', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1, 'input.mov')

    vi.mocked(runProcess).mockImplementation(async ({ args }: any) => {
      const outputPath = args[args.length - 1] as string
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, Buffer.from([1, 2, 3]))
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null
      }
    })

    const result = await compressVideoIfNeeded({ sourcePath })

    expect(result.compressed).toBe(true)
    expect(result.sourcePath).not.toBe(sourcePath)
    expect(path.extname(result.sourcePath)).toBe('.mp4')
    expect(result.bytes).toBe(3)
    expect(vi.mocked(runProcess)).toHaveBeenCalledTimes(1)

    await result.cleanup()
  })

  it('uses an even-dimension scale filter so odd widths do not fail', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1, 'input.mov')

    vi.mocked(runProcess).mockImplementation(async ({ args }: any) => {
      const outputPath = args[args.length - 1] as string
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, Buffer.from([1, 2, 3]))
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null
      }
    })

    await compressVideoIfNeeded({ sourcePath })

    const ffmpegArgs = vi.mocked(runProcess).mock.calls[0]?.[0]?.args as string[] | undefined
    expect(ffmpegArgs).toEqual(expect.arrayContaining([
      '-vf',
      expect.stringContaining('force_divisible_by=2')
    ]))
  })

  it('cleans up temp output when compression fails', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1)

    vi.mocked(runProcess).mockImplementation(async ({ args }: any) => {
      const outputPath = args[args.length - 1] as string
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, Buffer.from([1, 2, 3]))
      throw Object.assign(new Error('ffmpeg exited 1'), { code: 'PROCESS_EXIT_NON_ZERO', exitCode: 1 })
    })

    const rmSpy = vi.spyOn(fs, 'rm')

    await expect(compressVideoIfNeeded({ sourcePath })).rejects.toMatchObject({
      code: 'VIDEO_COMPRESS_FAILED'
    })

    expect(rmSpy).toHaveBeenCalled()
  })

  it('throws a stable app error when ffmpeg is missing', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1)

    vi.mocked(runProcess).mockRejectedValueOnce(
      Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'PROCESS_BINARY_MISSING' })
    )

    await expect(compressVideoIfNeeded({ sourcePath })).rejects.toMatchObject({
      name: 'AppError',
      code: 'VIDEO_COMPRESS_FFMPEG_MISSING',
      statusCode: 422
    })
  })

  it('throws a stable app error when ffmpeg exits non-zero', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1)

    vi.mocked(runProcess).mockRejectedValueOnce(
      Object.assign(new Error('ffmpeg exited 1'), {
        code: 'PROCESS_EXIT_NON_ZERO',
        exitCode: 1,
        stderr: 'boom'
      })
    )

    await expect(compressVideoIfNeeded({ sourcePath })).rejects.toMatchObject({
      name: 'AppError',
      code: 'VIDEO_COMPRESS_FAILED',
      statusCode: 422,
      data: {
        stderr: 'boom'
      }
    })
  })

  it('can be aborted and cleans up partial outputs', async () => {
    const sourcePath = await createSparseVideoFile(MAX_BYTES + 1)
    const controller = new AbortController()
    const abortError = new DOMException('Aborted', 'AbortError')
    let outputPath = ''

    vi.mocked(runProcess).mockImplementation(async ({ args, signal }: any) => {
      outputPath = args[args.length - 1] as string
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, Buffer.from([1, 2, 3]))

      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(abortError), { once: true })
      })
    })

    const promise = compressVideoIfNeeded({ sourcePath, signal: controller.signal, timeoutMs: 30_000 })

    controller.abort(abortError)

    await expect(promise).rejects.toMatchObject({
      name: 'AppError',
      code: 'VIDEO_COMPRESS_ABORTED',
      statusCode: 499
    })

    await expect(fs.stat(outputPath)).rejects.toThrow()
  })
})
