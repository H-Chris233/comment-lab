import { createApp, toNodeListener } from 'h3'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import authStatusHandler from '../../server/api/auth/status.get'
import authLoginHandler from '../../server/api/auth/login.post'
import authSetPasswordHandler from '../../server/api/auth/set-password.post'
import authChangePasswordHandler from '../../server/api/auth/change-password.post'
import authLogoutHandler from '../../server/api/auth/logout.post'

function cookieFromResponse(res: any) {
  return Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0]?.split(';')[0] || '' : ''
}

describe('auth api', () => {
  it('首次访问时没有密码', async () => {
    const app = createApp()
    app.use('/api/auth/status', authStatusHandler)

    const res = await request(toNodeListener(app)).get('/api/auth/status')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.hasPassword).toBe(false)
    expect(res.body.data.authenticated).toBe(false)
  })

  it('首次设置密码后会自动解锁', async () => {
    const app = createApp()
    app.use('/api/auth/status', authStatusHandler)
    app.use('/api/auth/set-password', authSetPasswordHandler)

    const setRes = await request(toNodeListener(app))
      .post('/api/auth/set-password')
      .send({ password: 'abcd1234', confirmPassword: 'abcd1234' })

    expect(setRes.status).toBe(200)
    expect(setRes.body.ok).toBe(true)

    const cookie = cookieFromResponse(setRes)
    expect(cookie).toContain('comment-lab-session=')

    const statusRes = await request(toNodeListener(app))
      .get('/api/auth/status')
      .set('Cookie', cookie)

    expect(statusRes.body.data.hasPassword).toBe(true)
    expect(statusRes.body.data.authenticated).toBe(true)
  })

  it('密码错误时拒绝登录', async () => {
    const app = createApp()
    app.use('/api/auth/set-password', authSetPasswordHandler)
    app.use('/api/auth/login', authLoginHandler)

    await request(toNodeListener(app))
      .post('/api/auth/set-password')
      .send({ password: 'abcd1234', confirmPassword: 'abcd1234' })

    const loginRes = await request(toNodeListener(app))
      .post('/api/auth/login')
      .send({ password: 'wrong-pass' })

    expect(loginRes.status).toBe(401)
    expect(loginRes.body.ok).toBe(false)
    expect(loginRes.body.code).toBe('INVALID_PASSWORD')
  })

  it('已解锁状态下可以修改密码且当前会话继续有效', async () => {
    const app = createApp()
    app.use('/api/auth/set-password', authSetPasswordHandler)
    app.use('/api/auth/change-password', authChangePasswordHandler)
    app.use('/api/auth/login', authLoginHandler)
    app.use('/api/auth/status', authStatusHandler)
    app.use('/api/auth/logout', authLogoutHandler)

    const setRes = await request(toNodeListener(app))
      .post('/api/auth/set-password')
      .send({ password: 'abcd1234', confirmPassword: 'abcd1234' })
    const cookie = cookieFromResponse(setRes)

    const changeRes = await request(toNodeListener(app))
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ password: 'newpass99', confirmPassword: 'newpass99' })

    expect(changeRes.status).toBe(200)
    expect(changeRes.body.ok).toBe(true)

    const statusRes = await request(toNodeListener(app))
      .get('/api/auth/status')
      .set('Cookie', cookie)

    expect(statusRes.status).toBe(200)
    expect(statusRes.body.data.authenticated).toBe(true)

    const oldLogin = await request(toNodeListener(app))
      .post('/api/auth/login')
      .send({ password: 'abcd1234' })

    expect(oldLogin.status).toBe(401)

    const newLogin = await request(toNodeListener(app))
      .post('/api/auth/login')
      .send({ password: 'newpass99' })

    expect(newLogin.status).toBe(200)
  })

  it('退出当前会话后会清除解锁状态', async () => {
    const app = createApp()
    app.use('/api/auth/set-password', authSetPasswordHandler)
    app.use('/api/auth/logout', authLogoutHandler)
    app.use('/api/auth/status', authStatusHandler)

    const setRes = await request(toNodeListener(app))
      .post('/api/auth/set-password')
      .send({ password: 'abcd1234', confirmPassword: 'abcd1234' })

    const cookie = cookieFromResponse(setRes)
    const logoutRes = await request(toNodeListener(app))
      .post('/api/auth/logout')
      .set('Cookie', cookie)

    expect(logoutRes.status).toBe(200)
    expect(logoutRes.body.data.authenticated).toBe(false)
    expect(logoutRes.headers['set-cookie']?.[0]).toContain('Max-Age=0')

    const statusRes = await request(toNodeListener(app))
      .get('/api/auth/status')

    expect(statusRes.body.data.authenticated).toBe(false)
  })
})
