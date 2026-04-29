import { afterEach, describe, expect, it, vi } from 'vitest'

async function importFileServiceWithCloseOnlyWriter() {
  vi.resetModules()
  vi.doMock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    class CloseOnlyWriter {
      private listeners = new Map<string, Array<(...args: any[]) => void>>()

      once(event: string, listener: (...args: any[]) => void) {
        const wrapped = (...args: any[]) => {
          this.off(event, wrapped)
          listener(...args)
        }
        const current = this.listeners.get(event) ?? []
        current.push(wrapped)
        this.listeners.set(event, current)
        return this
      }

      off(event: string, listener: (...args: any[]) => void) {
        const current = this.listeners.get(event) ?? []
        this.listeners.set(event, current.filter((item) => item !== listener))
        return this
      }

      emit(event: string, ...args: any[]) {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(...args)
        }
      }

      write() {
        return true
      }

      end() {
        queueMicrotask(() => {
          this.emit('finish')
          this.emit('close')
        })
      }

      destroy() {
        queueMicrotask(() => {
          this.emit('close')
        })
        return this
      }
    }

    return {
      ...actual,
      createWriteStream: () => new CloseOnlyWriter()
    }
  })

  return await import('../../server/services/file')
}

describe('file download regressions', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('streamToDisk 在 destroy 只触发 close 时也不会卡住清理', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get(name: string) {
          if (name === 'content-type') return 'video/mp4'
          return null
        }
      },
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2, 3]) })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn().mockResolvedValue(undefined)
        })
      },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
    }))

    const { downloadVideoUrlToTempFile } = await importFileServiceWithCloseOnlyWriter()
    const outcome = await Promise.race([
      downloadVideoUrlToTempFile({
        videoUrl: 'https://example.com/video.mp4',
        requestId: 'req_test',
        streamToDisk: true,
        maxBytes: 2
      }).then(() => 'resolved').catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve('delayed'), 100))
    ])

    expect(outcome).not.toBe('delayed')
    expect(outcome).toMatchObject({
      code: 'FILE_TOO_LARGE'
    })
  })

  it('client abort 后不会继续重试下载', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort(new Error('CLIENT_ABORTED'))
      throw new Error('aborted')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { downloadVideoUrlToTempFile } = await import('../../server/services/file')
    const promise = downloadVideoUrlToTempFile({
      videoUrl: 'https://example.com/video.mp4',
      requestId: 'req_abort',
      signal: controller.signal
    })
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'CLIENT_ABORTED'
    })

    await vi.advanceTimersByTimeAsync(601)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await assertion
  })
})
