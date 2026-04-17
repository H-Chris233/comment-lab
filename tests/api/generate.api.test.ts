import { createApp, toNodeListener } from 'h3'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createAppError } from '../../server/utils/errors'

vi.mock('../../server/services/ai', () => ({
  generateFromVideoBase64: vi.fn(),
  generateFromVideoUrl: vi.fn()
}))

vi.mock('../../server/services/douyin', () => ({
  parseDouyinLink: vi.fn(),
  verifyVideoUrlReachable: vi.fn()
}))

import { generateFromVideoBase64 } from '../../server/services/ai'
import generateHandler from '../../server/api/generate.post'

describe('POST /api/generate', () => {
  it('参数缺失时返回 INVALID_INPUT', async () => {
    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '100')

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


  it('json 输出格式会按 JSON 数组解析', async () => {
    vi.mocked(generateFromVideoBase64).mockResolvedValueOnce({
      rawText: JSON.stringify(['第一条评论', '第二条评论', '第二条评论']),
      model: 'qwen3.5-omni-plus',
      streamChunkCount: 3,
      durationMs: 20
    } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '2')
      .field('outputFormat', 'json')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.comments).toEqual(['第一条评论', '第二条评论'])
  })

  it('json 输出格式非法时返回 MODEL_OUTPUT_INVALID_FORMAT', async () => {
    vi.mocked(generateFromVideoBase64).mockResolvedValueOnce({
      rawText: '不是合法json数组',
      model: 'qwen3.5-omni-plus',
      streamChunkCount: 2,
      durationMs: 10
    } as any)

    const app = createApp()
    app.use('/api/generate', generateHandler)

    const res = await request(toNodeListener(app))
      .post('/api/generate')
      .field('mode', 'upload')
      .field('count', '100')
      .field('outputFormat', 'json')
      .field('basePrompt', 'base')
      .attach('video', Buffer.from('1234'), { filename: 'ok.mp4', contentType: 'video/mp4' })

    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('MODEL_OUTPUT_INVALID_FORMAT')
  })

  it('模型返回空文本时返回 MODEL_OUTPUT_EMPTY', async () => {
    vi.mocked(generateFromVideoBase64).mockRejectedValueOnce(
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
