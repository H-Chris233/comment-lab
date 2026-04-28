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

vi.mock('../../server/services/auth', () => ({
  assertAuthenticated: vi.fn().mockResolvedValue({ hasPassword: true, authenticated: true })
}))

vi.mock('../../server/services/douyin', () => ({
  parseDouyinLink: vi.fn().mockResolvedValue({ ok: true, videoUrl: 'https://www.douyin.com/video/7626738541439099121', awemeId: '7626738541439099121' }),
  resolveDouyinDownloadVideoUrl: vi.fn().mockResolvedValue('https://cdn.example.com/cn-high.mp4'),
  resolveDouyinLowQualityDownloadVideoUrl: vi.fn().mockResolvedValue('https://cdn.example.com/cn-low.mp4')
}))

import { generateFromVideoUrl, generateFromVideoFile } from '../../server/services/ai'
import { downloadVideoUrlToTempFile, saveVideoUploadToTempFile } from '../../server/services/file'
import { parseDouyinLink, resolveDouyinDownloadVideoUrl, resolveDouyinLowQualityDownloadVideoUrl } from '../../server/services/douyin'
import generateHandler from '../../server/api/generate.post'

function styleTargetFromPrompt(prompt: string) {
  const styleMatch = prompt.match(/当前长度桶：(?<style>短评论|中评论|长评论)组/u)
  if (styleMatch?.groups?.style) {
    const style = styleMatch.groups.style
    const countMatch = prompt.match(/输出\s+(\d+)\s+条/)
    return {
      count: Number(countMatch?.[1] || 1),
      style
    }
  }

  const legacyStyleMatch = prompt.match(/输出\s+(\d+)\s+条(短评论|中评论|长评论)/)
  if (legacyStyleMatch?.[1] && legacyStyleMatch[2]) {
    return {
      count: Number(legacyStyleMatch[1]),
      style: legacyStyleMatch[2]
    }
  }

  const fallbackCount = prompt.match(/输出\s+(\d+)\s+条/)
  return {
    count: Number(fallbackCount?.[1] || 1),
    style: '评论'
  }
}

let styleRawTextRun = 0

function buildStyleRawText(prompt: string, count?: number) {
  const target = styleTargetFromPrompt(prompt)
  const itemCount = Math.max(Number(count || target.count || 0), 1)
  const run = ++styleRawTextRun
  return Array.from({ length: itemCount }, (_, index) => `${target.style}-${String(index + 1).padStart(2, '0')}-r${run}`).join('\n')
}


beforeEach(() => {
  vi.clearAllMocks()
  styleRawTextRun = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: {
      original_video_url: 'https://cdn.example.com/cn-fallback.mp4'
    }
  }), { status: 200 })) as any)
  vi.mocked(parseDouyinLink).mockResolvedValue({ ok: true, videoUrl: 'https://www.douyin.com/video/7626738541439099121' } as any)
  vi.mocked(saveVideoUploadToTempFile).mockResolvedValue({
    sourcePath: '/tmp/mock.mp4',
    cleanup: async () => {}
  } as any)
  vi.mocked(generateFromVideoUrl).mockImplementation(async (params: any) => ({
    rawText: buildStyleRawText(params.prompt, params.stopAfterItems),
    model: 'qwen3.5-omni-plus',
    streamChunkCount: Math.max(1, params.stopAfterItems || 1),
    durationMs: 10
  } as any))
  vi.mocked(generateFromVideoFile).mockImplementation(async (params: any) => ({
    rawText: buildStyleRawText(params.prompt, params.stopAfterItems),
    model: 'qwen3.5-omni-plus',
    streamChunkCount: Math.max(1, params.stopAfterItems || 1),
    durationMs: 10
  } as any))
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

  it('单轮会按 3 个风格桶并行调用并合并结果', async () => {
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
    expect(res.body.data.rawText).toContain('短评论-01')
    expect(res.body.data.rawText).toContain('中评论-01')
    expect(res.body.data.rawText).toContain('长评论-01')
    expect(vi.mocked(generateFromVideoFile)).toHaveBeenCalledTimes(3)

    const stopAfterItems = vi.mocked(generateFromVideoFile).mock.calls.map((call) => (call[0] as any).stopAfterItems)
    expect(stopAfterItems).toEqual([40, 40, 20])
  })

  it('link 模式在 inputMode=url 时直接传视频 URL 给模型', async () => {
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

  it('link 模式会把 TikHub 标题注入到 prompt 中', async () => {
    vi.mocked(parseDouyinLink).mockResolvedValueOnce({
      ok: true,
      videoUrl: 'https://www.douyin.com/video/7626738541439099121',
      title: '这个夏天最治愈的一段'
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

    const firstCallArgs = vi.mocked(generateFromVideoUrl).mock.calls[0]?.[0] as any
    expect(firstCallArgs.prompt).toContain('视频标题：这个夏天最治愈的一段')
  })

  it('流式模式会在每条评论完成时推送 item 事件', async () => {
    vi.mocked(generateFromVideoFile).mockImplementation(async (params: any) => {
      params.onLine?.('即时-1-1')
      params.onLine?.('这是一条超过三十个字符的长长评论内容应该被跳过这是一条超过三十个字符的长长评论内容应该被跳过')
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
    expect(res.text).toContain('即时-1-3')
    expect(res.text).not.toContain('超过三十个字符的长长评论内容应该被跳过')
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

  it('CN 区域链接在 inputMode=file 时会优先下载高画质链接', async () => {
    vi.mocked(parseDouyinLink).mockResolvedValueOnce({
      ok: true,
      videoUrl: 'https://cdn.example.com/high.mp4',
      awemeId: '7626738541439099121',
      raw: {
        data: {
          aweme_detail: {
            video: {
              bit_rate: [
                {
                  bit_rate: 900000,
                  play_addr: { url_list: ['https://cdn.example.com/high.mp4'] }
                },
                {
                  bit_rate: 120000,
                  play_addr: { url_list: ['https://cdn.example.com/low.mp4'] }
                }
              ]
            }
          }
        }
      }
    } as any)

    vi.mocked(resolveDouyinDownloadVideoUrl).mockResolvedValueOnce('https://cdn.example.com/cn-high.mp4' as any)
    vi.mocked(downloadVideoUrlToTempFile).mockResolvedValueOnce({
      bytes: 4,
      mime: 'video/mp4',
      sourcePath: '/tmp/mock.mp4',
      cleanup: async () => {}
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
    expect(vi.mocked(downloadVideoUrlToTempFile).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      videoUrl: 'https://cdn.example.com/cn-high.mp4'
    }))
  })

  it('CN 区域在高画质过大时会回退到低画质链接', async () => {
    vi.mocked(resolveDouyinDownloadVideoUrl).mockResolvedValueOnce('https://cdn.example.com/cn-high.mp4' as any)
    vi.mocked(resolveDouyinLowQualityDownloadVideoUrl).mockResolvedValueOnce('https://cdn.example.com/cn-low.mp4' as any)
    vi.mocked(downloadVideoUrlToTempFile)
      .mockRejectedValueOnce(createAppError({
        code: 'FILE_TOO_LARGE',
        message: '视频大小超过限制（>100MB）',
        statusCode: 413
      }))
      .mockResolvedValueOnce({
        bytes: 4,
        mime: 'video/mp4',
        sourcePath: '/tmp/mock.mp4',
        cleanup: async () => {}
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
    expect(downloadVideoUrlToTempFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(downloadVideoUrlToTempFile).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      videoUrl: 'https://cdn.example.com/cn-high.mp4'
    }))
    expect(vi.mocked(downloadVideoUrlToTempFile).mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      videoUrl: 'https://cdn.example.com/cn-low.mp4'
    }))
  })

  it('upload 模式会先保存到本地临时文件再交给 DashScope SDK', async () => {
    vi.mocked(saveVideoUploadToTempFile).mockResolvedValueOnce({
      sourcePath: '/tmp/uploaded.mp4',
      cleanup: async () => {}
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

  it('可通过请求指定不同模型', async () => {
    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('model', 'qwen3.6-plus')
      .field('count', '2')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(vi.mocked(generateFromVideoFile)).toHaveBeenCalled()
    const firstCallArgs = vi.mocked(generateFromVideoFile).mock.calls[0]?.[0] as any
    expect(firstCallArgs.model).toBe('qwen3.6-plus')
  })

  it('模型输出全部无效时也会返回原始输出用于调试', async () => {
    vi.mocked(generateFromVideoFile).mockImplementation(async () => ({
      rawText: '评论如下\n好',
      model: 'qwen3.5-omni-plus',
      streamChunkCount: 2,
      durationMs: 10
    } as any))

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '1')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(422)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('MODEL_OUTPUT_EMPTY')
    expect(res.body.data.rawText).toContain('评论如下')
    expect(res.body.data.promptTrace).toEqual(expect.any(Array))
  })
})
