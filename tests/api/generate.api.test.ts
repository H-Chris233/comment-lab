import { createApp, toNodeListener } from 'h3'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppError } from '../../server/utils/errors'

vi.mock('../../server/services/ai', () => ({
  generateFromVideoUrl: vi.fn(),
  generateFromVideoFile: vi.fn()
}))

vi.mock('../../server/services/file', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/file')>('../../server/services/file')
  return {
    ...actual,
    downloadVideoUrlToTempFile: vi.fn(),
    saveVideoUploadToTempFile: vi.fn()
  }
})

vi.mock('../../server/services/douyin', () => ({
  parseDouyinLink: vi.fn().mockResolvedValue({ ok: true, videoUrl: 'https://www.douyin.com/video/7626738541439099121' })
}))

import { generateFromVideoUrl, generateFromVideoFile } from '../../server/services/ai'
import { downloadVideoUrlToTempFile, saveVideoUploadToTempFile } from '../../server/services/file'
import { parseDouyinLink } from '../../server/services/douyin'
import generateHandler from '../../server/api/generate.post'


beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(parseDouyinLink).mockResolvedValue({ ok: true, videoUrl: 'https://www.douyin.com/video/7626738541439099121' } as any)
  vi.mocked(saveVideoUploadToTempFile).mockResolvedValue({
    sourcePath: '/tmp/mock.mp4',
    cleanup: async () => {}
  } as any)
})

describe('POST /api/generate', () => {
  it('参数缺失时返回 INVALID_INPUT', async () => {
    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')

    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('INVALID_INPUT')
  })

  it('文件过大时返回 FILE_TOO_LARGE', async () => {
    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '100')
      .field('basePrompt', 'base')
      .attach('video', Buffer.alloc(101 * 1024 * 1024), { filename: 'big.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(413)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('FILE_TOO_LARGE')
  }, 30_000)

  it('单轮会按 40/40/20 并行调用三次模型并合并结果', async () => {
    vi.mocked(generateFromVideoFile)
      .mockResolvedValueOnce({
        rawText: Array.from({ length: 40 }, (_, i) => `短-${i + 1}`).join('\n'),
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 5,
        durationMs: 10
      } as any)
      .mockResolvedValueOnce({
        rawText: Array.from({ length: 40 }, (_, i) => `中-${i + 1}`).join('\n'),
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 4,
        durationMs: 8
      } as any)
      .mockResolvedValueOnce({
        rawText: Array.from({ length: 20 }, (_, i) => `长-${i + 1}`).join('\n'),
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 3,
        durationMs: 7
      } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '100')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.finalCount).toBe(100)
    expect(vi.mocked(generateFromVideoFile)).toHaveBeenCalledTimes(3)

    const firstCallArgs = vi.mocked(generateFromVideoFile).mock.calls[0]?.[0] as any
    const secondCallArgs = vi.mocked(generateFromVideoFile).mock.calls[1]?.[0] as any
    const thirdCallArgs = vi.mocked(generateFromVideoFile).mock.calls[2]?.[0] as any
    expect(firstCallArgs.stopAfterItems).toBe(40)
    expect(secondCallArgs.stopAfterItems).toBe(40)
    expect(thirdCallArgs.stopAfterItems).toBe(20)
  })

  it('link 模式在 inputMode=url 时直接传视频 URL 给模型', async () => {
    vi.mocked(generateFromVideoUrl)
      .mockResolvedValueOnce({
        rawText: '第一条\n第二条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 10
      } as any)
      .mockResolvedValueOnce({
        rawText: '第三条\n第四条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 9
      } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'link')
      .field('inputMode', 'url')
      .field('url', 'https://v.douyin.com/abcde/')
      .field('count', '2')
      .field('basePrompt', 'base')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(generateFromVideoUrl).toHaveBeenCalledTimes(2)
    expect(downloadVideoUrlToTempFile).not.toHaveBeenCalled()
    expect(generateFromVideoFile).not.toHaveBeenCalled()
  })

  it('流式模式会在每条评论完成时推送 item 事件', async () => {
    vi.mocked(generateFromVideoFile).mockImplementation(async (params: any) => {
      params.onLine?.('即时-1-1')
      params.onLine?.('即时-1-2')
      params.onLine?.('即时-1-3')
      return {
        rawText: '第1条\n第2条\n第3条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 1,
        durationMs: 1
      } as any
    })

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate?stream=1')
      .set('Accept', 'text/event-stream')
      .field('mode', 'upload')
      .field('count', '2')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect((res.text.match(/event: item/g) || []).length).toBe(2)
    expect(res.text).toContain('即时-1-1')
    expect(res.text).toContain('即时-1-2')
    expect(res.text).not.toContain('即时-1-3')
  })

  it('link 解析失败时返回 PARSE_LINK_FAILED', async () => {
    vi.mocked(parseDouyinLink).mockRejectedValueOnce(
      createAppError({ code: 'PARSE_LINK_FAILED', message: '链接解析失败，请改为上传视频', statusCode: 422 })
    )

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'link')
      .field('url', 'https://v.douyin.com/abcde/')
      .field('count', '2')
      .field('basePrompt', 'base')

    expect(res.status).toBe(422)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('PARSE_LINK_FAILED')
  })

  it('link 模式在 inputMode=file 时先下载视频再以本地文件调模型', async () => {
    vi.mocked(downloadVideoUrlToTempFile).mockResolvedValueOnce({
      bytes: 4,
      mime: 'video/mp4',
      sourcePath: '/tmp/mock.mp4',
      cleanup: async () => {}
    } as any)

    vi.mocked(generateFromVideoFile).mockResolvedValueOnce({
      rawText: '第一条\n第二条',
      model: 'qwen3.5-omni-plus',
      streamChunkCount: 2,
      durationMs: 10
    } as any)
      .mockResolvedValueOnce({
        rawText: '第三条\n第四条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 9
      } as any)
      .mockResolvedValueOnce({
        rawText: '第五条\n第六条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 8
      } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'link')
      .field('inputMode', 'file')
      .field('url', 'https://v.douyin.com/abcde/')
      .field('count', '2')
      .field('basePrompt', 'base')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(downloadVideoUrlToTempFile).toHaveBeenCalledTimes(1)
    expect(generateFromVideoFile).toHaveBeenCalledTimes(2)
  })

  it('upload 模式会先保存到本地临时文件再交给 DashScope SDK', async () => {
    vi.mocked(saveVideoUploadToTempFile).mockResolvedValueOnce({
      sourcePath: '/tmp/uploaded.mp4',
      cleanup: async () => {}
    } as any)

    vi.mocked(generateFromVideoFile).mockResolvedValueOnce({
      rawText: '第一条\n第二条',
      model: 'qwen3.5-omni-plus',
      streamChunkCount: 2,
      durationMs: 10
    } as any)
      .mockResolvedValueOnce({
        rawText: '第三条\n第四条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 9
      } as any)
      .mockResolvedValueOnce({
        rawText: '第五条\n第六条',
        model: 'qwen3.5-omni-plus',
        streamChunkCount: 2,
        durationMs: 8
      } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '2')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(saveVideoUploadToTempFile).toHaveBeenCalledTimes(1)
    expect(generateFromVideoFile).toHaveBeenCalledTimes(2)
    const firstCallArgs = vi.mocked(generateFromVideoFile).mock.calls[0]?.[0] as any
    expect(firstCallArgs.videoPath).toBe('/tmp/uploaded.mp4')
  })

  it('模型返回空文本时返回 MODEL_OUTPUT_EMPTY', async () => {
    vi.mocked(generateFromVideoFile).mockRejectedValue(
      createAppError({ code: 'MODEL_OUTPUT_EMPTY', message: '模型输出为空，请重试', statusCode: 502 })
    )

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '100')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('MODEL_OUTPUT_EMPTY')
  })
})
