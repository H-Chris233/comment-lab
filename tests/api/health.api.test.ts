import { createApp, toNodeListener } from 'h3'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import healthHandler from '../../server/api/health.get'

describe('GET /api/health', () => {
  it('返回健康状态', async () => {
    const app = createApp()
    app.use('/api/health', healthHandler)

    const server = toNodeListener(app)
    const res = await request(server).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.ok).toBe(true)
    expect(typeof res.body.requestId).toBe('string')
  })
})
