import { createError, defineEventHandler, getRequestIP } from 'h3'

function isLocalAddress(ip: string | null | undefined) {
  if (!ip) return true
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export default defineEventHandler((event) => {
  if (process.env.COMMENT_LAB_ALLOW_REMOTE === '1') return

  const ip = getRequestIP(event, { xForwardedFor: true })
  if (isLocalAddress(ip)) return

  throw createError({
    statusCode: 403,
    statusMessage: 'FORBIDDEN_REMOTE_ACCESS',
    message: '仅允许本机访问，请勿暴露到公网'
  })
})
