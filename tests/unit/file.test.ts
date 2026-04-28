import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadVideoUrlToTempFile, getMaxDownloadVideoBytes, getMaxVideoBytes, saveVideoUploadToTempFile } from '../../server/services/file'

const TEN_MINUTES = 10 * 60 * 1000

describe('video temp retention', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as any)
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined as any)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4'
            if (name === 'content-length') return '3'
            return null
          }
        },
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2]) })
              .mockResolvedValueOnce({ done: false, value: Uint8Array.from([3]) })
              .mockResolvedValueOnce({ done: true, value: undefined })
          })
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('下载的视频会在 10 分钟后才清理', async () => {
    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    await result.cleanup()
    expect(fs.rm).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 1)
    expect(fs.rm).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fs.rm).toHaveBeenCalledTimes(1)
  })

  it('上传的视频仍然会立即清理', async () => {
    const result = await saveVideoUploadToTempFile(
      {
        type: 'video/mp4',
        data: Buffer.from([1, 2, 3])
      },
      'req_test'
    )

    expect(result.bytes).toBe(3)
    expect(result.mime).toBe('video/mp4')
    await result.cleanup()
    expect(fs.rm).toHaveBeenCalledTimes(1)
  })

  it('下载视频保留时间可以通过 runtimeConfig 覆盖', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tempVideoRetentionMinutes: 3
    }))

    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    await result.cleanup()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
    expect(fs.rm).toHaveBeenCalledTimes(1)
  })

  it('相对路径的视频缓存目录会按仓库根目录解析为绝对路径', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tempVideoDir: '.tmp/douyin-downloads'
    }))

    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    expect(path.isAbsolute(result.sourcePath)).toBe(true)
    expect(result.sourcePath).toContain(path.join(process.cwd(), '.tmp', 'douyin-downloads'))
  })

  it('存在流式 body 时也能正常下载并落盘', async () => {
    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    expect(result.bytes).toBe(3)
    expect(result.mime).toBe('video/mp4')
    expect(path.basename(result.sourcePath)).toMatch(/^video\.mp4$/)
  })

  it('streamToDisk 模式会绕过 buffer 落盘并在 raw ceiling 上提前拦截', async () => {
    const writesBeforeStream = vi.mocked(fs.writeFile).mock.calls.length

    const streamed = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test',
      streamToDisk: true,
      maxBytes: 10
    })

    expect(streamed.bytes).toBe(3)
    expect(streamed.mime).toBe('video/mp4')
    expect(vi.mocked(fs.writeFile).mock.calls.length).toBe(writesBeforeStream)

    await streamed.cleanup()
    expect(fs.rm).toHaveBeenCalled()

    vi.clearAllMocks()

    await expect(downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test',
      streamToDisk: true,
      maxBytes: 2
    })).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE'
    })
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('下载视频不再依赖内部超时定时器', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })
})

describe('download video size limit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认不限制下载大小', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({}))

    expect(getMaxDownloadVideoBytes()).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('upload video size limit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认上传大小限制为 1000MB', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({}))

    expect(getMaxVideoBytes()).toBe(1000 * 1024 * 1024)
  })
})
