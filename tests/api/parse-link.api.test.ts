import { createApp, toNodeListener } from 'h3'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createAppError } from '../../server/utils/errors'

vi.mock('../../server/services/douyin', () => ({
  parseDouyinLink: vi.fn()
}))

import { parseDouyinLink } from '../../server/services/douyin'
import parseLinkHandler from '../../server/api/parse-link.post'

describe('POST /api/parse-link', () => {
  it('成功返回 videoUrl', async () => {
    vi.mocked(parseDouyinLink).mockResolvedValueOnce({ ok: true, videoUrl: 'https://cdn.example.com/v.mp4' } as any)

    const app = createApp()
    app.use('/api/parse-link', parseLinkHandler)

    const res = await request(toNodeListener(app))
      .post('/api/parse-link')
      .send({ url: 'https://v.douyin.com/abc/' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.videoUrl).toContain('https://')
  })

  it('失败时返回结构化错误', async () => {
    vi.mocked(parseDouyinLink).mockRejectedValueOnce(
      createAppError({ code: 'PARSE_LINK_FAILED', message: '链接解析失败，请改为上传视频', statusCode: 422 })
    )

    const app = createApp()
    app.use('/api/parse-link', parseLinkHandler)

    const res = await request(toNodeListener(app))
      .post('/api/parse-link')
      .send({ url: 'https://v.douyin.com/abc/' })

    expect(res.status).toBe(422)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('PARSE_LINK_FAILED')
  })
})
