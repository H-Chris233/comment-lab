import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadVideoUrlToTempFile, formatDownloadResumeMessage, formatDownloadRetryMessage, getMaxDownloadVideoBytes, getMaxVideoBytes, saveVideoUploadToTempFile } from '../../server/services/file'

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
    delete process.env.TEMP_VIDEO_DIR
  })

  it('下载的视频在任务结束后立即清理', async () => {
    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    const callsBeforeCleanup = vi.mocked(fs.rm).mock.calls.length
    await result.cleanup()
    expect(vi.mocked(fs.rm).mock.calls.length).toBeGreaterThan(callsBeforeCleanup)
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
    const callsBeforeCleanup = vi.mocked(fs.rm).mock.calls.length
    await result.cleanup()
    expect(vi.mocked(fs.rm).mock.calls.length).toBeGreaterThan(callsBeforeCleanup)
  })

  it('相对路径的视频缓存目录会按仓库根目录解析为绝对路径', async () => {
    process.env.TEMP_VIDEO_DIR = '.tmp/douyin-downloads'

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
    // First attempt stream truncates before writing, adding 1 call
    expect(vi.mocked(fs.writeFile).mock.calls.length).toBe(writesBeforeStream + 1)

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

  it('streamToDisk 模式会把关键下载状态回传给调用方', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4'
            if (name === 'content-length') return String(5 * 1024 * 1024 + 2)
            return null
          }
        },
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array(5 * 1024 * 1024) })
              .mockResolvedValueOnce({ done: false, value: new Uint8Array(2) })
              .mockResolvedValueOnce({ done: true, value: undefined })
          })
        },
        arrayBuffer: async () => new Uint8Array(5 * 1024 * 1024 + 2).buffer
      })
    )

    const statuses: Array<{ phase: string; message: string }> = []
    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test',
      streamToDisk: true,
      onStatus: (status) => {
        statuses.push({
          phase: status.phase,
          message: status.message
        })
      }
    })

    expect(result.bytes).toBe(5 * 1024 * 1024 + 2)
    expect(statuses[0]?.phase).toBe('downloading')
    expect(statuses.some((item) => item.message.includes('正在下载视频'))).toBe(true)
    expect(statuses.some((item) => item.message.includes('视频下载完成'))).toBe(true)
  })

  it('下载重试文案会携带已下载百分比', () => {
    expect(formatDownloadRetryMessage({
      attempt: 2,
      retryTimes: 2,
      percent: 67
    })).toBe('下载失败，正在重试（第 2/2 次，已下载 67%）')
  })

  it('下载续传文案会携带上次进度', () => {
    expect(formatDownloadResumeMessage({
      attempt: 2,
      retryTimes: 3,
      percent: 47
    })).toBe('下载中断，正在从 47% 继续下载（第 2/3 次）')
  })

  it('下载视频不再依赖内部计时器', async () => {
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')

    await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    })

    expect(timerSpy).not.toHaveBeenCalled()
    timerSpy.mockRestore()
  })

  it('streamToDisk 模式在第二次尝试时会携带 Range 从上次中断处继续下载', async () => {
    const fetchMock = vi.fn()
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        handler()
      }
      return 0 as any
    }) as any)
    const firstReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2, 3]) })
        .mockRejectedValueOnce(new TypeError('fetch failed')),
      cancel: vi.fn().mockResolvedValue(undefined)
    }
    const secondReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([4, 5]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined)
    }

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4'
            if (name === 'content-length') return '5'
            return null
          }
        },
        body: {
          getReader: () => firstReader
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4'
            if (name === 'content-length') return '2'
            if (name === 'content-range') return 'bytes 3-4/5'
            return null
          }
        },
        body: {
          getReader: () => secondReader
        },
        arrayBuffer: async () => Uint8Array.from([4, 5]).buffer
      })

    vi.stubGlobal('fetch', fetchMock)
    const statuses: Array<{ phase: string; message: string }> = []

    const resultPromise = downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test',
      streamToDisk: true,
      retryTimes: 2,
      onStatus: (status) => {
        statuses.push({
          phase: status.phase,
          message: status.message
        })
      }
    })

    const result = await resultPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Range: 'bytes=3-'
      })
    }))
    expect(result.bytes).toBe(5)
    expect(result.mime).toBe('video/mp4')
    expect(statuses.some((item) => item.phase === 'retrying' && item.message.includes('下载中断，正在从 60% 继续下载'))).toBe(true)
    await result.cleanup()
    timerSpy.mockRestore()
  })

  it('server 返回 200 忽略 Range 时 second attempt 不会污染残留文件', async () => {
    const fetchMock = vi.fn()
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        handler()
      }
      return 0 as any
    }) as any)

    const firstReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2, 3]) })
        .mockRejectedValueOnce(new TypeError('fetch failed')),
      cancel: vi.fn().mockResolvedValue(undefined)
    }
    const secondReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2, 3, 4, 5]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined)
    }

    fetchMock
      .mockResolvedValueOnce({
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
          getReader: () => firstReader
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4'
            if (name === 'content-length') return '5'
            return null
          }
        },
        body: {
          getReader: () => secondReader
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4, 5]).buffer
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test',
      streamToDisk: true,
      retryTimes: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Range: 'bytes=3-'
      })
    }))
    expect(result.bytes).toBe(5)
    expect(result.mime).toBe('video/mp4')
    // Verify the file was truncated before second attempt — the recovered file
    // should contain bytes [1,2,3,4,5], not [1,2,3,1,2,3,4,5]
    await result.cleanup()
    timerSpy.mockRestore()
  })

  it('fetch failed 时会自动重试并在耗尽后返回可重试的业务错误', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const promise = downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_test'
    }).catch((error) => error)

    await vi.runAllTimersAsync()
    const error = await promise

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(error).toMatchObject({
      code: 'VIDEO_FETCH_FAILED',
      message: '视频下载失败，请稍后重试',
      data: expect.objectContaining({
        reason: 'fetch failed',
        attempt: 3,
        retryTimes: 3
      })
    })
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
