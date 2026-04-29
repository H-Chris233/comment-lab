import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getRequestHeader, setCookie } from 'h3'
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createAppError } from '../utils/errors'
import { getAuthLockFilePath as resolveAuthLockFilePath, toActionableStorageError } from './app-paths'

export const AUTH_COOKIE_NAME = 'comment-lab-session'
const PASSWORD_MIN_LENGTH = 4
const PBKDF2_ITERATIONS = 120_000
const PBKDF2_KEYLEN = 64
const PBKDF2_DIGEST = 'sha256'

export interface AuthState {
  passwordHash: string
  passwordSalt: string
  sessionSecret: string
  createdAt: string
  updatedAt: string
}

export interface AuthStatus {
  hasPassword: boolean
  authenticated: boolean
}

function getAuthLockFilePath() {
  return resolveAuthLockFilePath()
}

function normalizePassword(value?: string) {
  return value?.trim() || ''
}

export function validatePasswordValue(value?: string) {
  const password = normalizePassword(value)
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: `密码至少 ${PASSWORD_MIN_LENGTH} 位`,
      statusCode: 400
    })
  }
  return password
}

function derivePasswordHash(password: string, salt: string) {
  const saltBuffer = Buffer.from(salt, 'hex')
  return pbkdf2Sync(password, saltBuffer, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('base64url')
}

function createPasswordSalt() {
  return randomBytes(16).toString('hex')
}

function createSessionSecret() {
  return randomBytes(32).toString('hex')
}

function createSessionToken(secret: string) {
  const issuedAt = Date.now().toString(36)
  const nonce = randomBytes(16).toString('base64url')
  const payload = `${issuedAt}.${nonce}`
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function isSecureAuthCookie(event: H3Event) {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedProto) {
    return forwardedProto === 'https'
  }

  const forwardedSsl = getRequestHeader(event, 'x-forwarded-ssl')?.trim().toLowerCase()
  if (forwardedSsl) {
    return forwardedSsl === 'on' || forwardedSsl === '1'
  }

  return Boolean((event.node.req.socket as import('node:net').Socket & { encrypted?: boolean }).encrypted)
}

function verifySessionToken(token: string, secret: string) {
  const parts = token.split('.')
  if (parts.length !== 3) return false

  const payload = `${parts[0]}.${parts[1]}`
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')

  if (expected.length !== parts[2].length) return false

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))
  } catch {
    return false
  }
}

function toNormalizedState(raw: unknown): AuthState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AuthState>

  if (typeof value.passwordHash !== 'string' || typeof value.passwordSalt !== 'string') return null

  const now = new Date().toISOString()
  return {
    passwordHash: value.passwordHash,
    passwordSalt: value.passwordSalt,
    sessionSecret: typeof value.sessionSecret === 'string' && value.sessionSecret.trim() ? value.sessionSecret : createSessionSecret(),
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : now
  }
}

async function saveAuthState(state: AuthState) {
  const filePath = getAuthLockFilePath()
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp-${randomBytes(6).toString('hex')}`
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(tempPath, filePath).catch(async () => {
      await fs.rm(filePath, { force: true }).catch(() => {})
      await fs.rename(tempPath, filePath)
    })
  } catch (error) {
    const mapped = toActionableStorageError(error, 'AUTH_STATE_SAVE_FAILED', '无法保存本地密码状态')
    throw createAppError(mapped)
  }
}

export async function loadAuthState(): Promise<AuthState | null> {
  const filePath = getAuthLockFilePath()

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const state = toNormalizedState(parsed)

    if (!state) {
      throw createAppError({
        code: 'AUTH_STATE_INVALID',
        message: '密码状态异常，请重新初始化',
        statusCode: 500,
        expose: false
      })
    }

    const hadMissingSecret = typeof (parsed as Partial<AuthState>).sessionSecret !== 'string' || !(parsed as Partial<AuthState>).sessionSecret?.trim()
    if (hadMissingSecret) {
      await saveAuthState(state)
    }

    return state
  } catch (error) {
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    if (error instanceof SyntaxError) {
      throw createAppError({
        code: 'AUTH_STATE_INVALID',
        message: '密码状态异常，请重新初始化',
        statusCode: 500,
        expose: false
      })
    }

    throw error
  }
}

export async function getAuthStatus(event: H3Event): Promise<AuthStatus> {
  const state = await loadAuthState()
  const hasPassword = Boolean(state?.passwordHash)
  const session = getCookie(event, AUTH_COOKIE_NAME) || ''
  const authenticated = Boolean(state && session && verifySessionToken(session, state.sessionSecret))

  return { hasPassword, authenticated }
}

export async function assertAuthenticated(event: H3Event) {
  const status = await getAuthStatus(event)
  if (!status.hasPassword || !status.authenticated) {
    throw createAppError({
      code: 'UNAUTHORIZED',
      message: '请先解锁密码锁',
      statusCode: 401
    })
  }

  return status
}

function issueSessionCookie(event: H3Event, state: AuthState) {
  setCookie(event, AUTH_COOKIE_NAME, createSessionToken(state.sessionSecret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureAuthCookie(event),
    path: '/'
  })
}

function clearSessionCookie(event: H3Event) {
  deleteCookie(event, AUTH_COOKIE_NAME, { path: '/' })
}

async function upsertPasswordState(password: string) {
  const existing = await loadAuthState()
  const now = new Date().toISOString()
  const passwordSalt = existing?.passwordSalt || createPasswordSalt()
  const state: AuthState = {
    passwordHash: derivePasswordHash(password, passwordSalt),
    passwordSalt,
    sessionSecret: existing?.sessionSecret || createSessionSecret(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
  await saveAuthState(state)
  return state
}

export async function setInitialPassword(event: H3Event, password: string, confirmPassword?: string) {
  const nextPassword = validatePasswordValue(password)
  const confirm = normalizePassword(confirmPassword)

  if (confirm && confirm !== nextPassword) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '两次输入的密码不一致',
      statusCode: 400
    })
  }

  const existing = await loadAuthState()
  if (existing?.passwordHash) {
    throw createAppError({
      code: 'PASSWORD_ALREADY_SET',
      message: '密码已经设置过了，请直接输入密码进入',
      statusCode: 409
    })
  }

  const state = await upsertPasswordState(nextPassword)
  issueSessionCookie(event, state)

  return { hasPassword: true, authenticated: true }
}

export async function loginWithPassword(event: H3Event, password: string) {
  const nextPassword = validatePasswordValue(password)
  const existing = await loadAuthState()

  if (!existing?.passwordHash) {
    throw createAppError({
      code: 'PASSWORD_NOT_SET',
      message: '密码尚未设置，请先创建密码',
      statusCode: 409
    })
  }

  const expectedHash = derivePasswordHash(nextPassword, existing.passwordSalt)
  if (expectedHash.length !== existing.passwordHash.length) {
    throw createAppError({
      code: 'INVALID_PASSWORD',
      message: '密码错误',
      statusCode: 401
    })
  }

  const ok = timingSafeEqual(Buffer.from(expectedHash), Buffer.from(existing.passwordHash))
  if (!ok) {
    throw createAppError({
      code: 'INVALID_PASSWORD',
      message: '密码错误',
      statusCode: 401
    })
  }

  issueSessionCookie(event, existing)
  return { hasPassword: true, authenticated: true }
}

export async function changePassword(event: H3Event, password: string, confirmPassword?: string) {
  const status = await assertAuthenticated(event)
  if (!status.authenticated) {
    throw createAppError({
      code: 'UNAUTHORIZED',
      message: '请先解锁密码锁',
      statusCode: 401
    })
  }

  const nextPassword = validatePasswordValue(password)
  const confirm = normalizePassword(confirmPassword)

  if (confirm && confirm !== nextPassword) {
    throw createAppError({
      code: 'INVALID_INPUT',
      message: '两次输入的密码不一致',
      statusCode: 400
    })
  }

  const existing = await loadAuthState()
  if (!existing?.passwordHash) {
    throw createAppError({
      code: 'PASSWORD_NOT_SET',
      message: '密码尚未设置，请先创建密码',
      statusCode: 409
    })
  }

  const updated: AuthState = {
    ...existing,
    passwordSalt: createPasswordSalt(),
    passwordHash: '',
    updatedAt: new Date().toISOString()
  }
  updated.passwordHash = derivePasswordHash(nextPassword, updated.passwordSalt)

  await saveAuthState(updated)
  issueSessionCookie(event, updated)

  return { hasPassword: true, authenticated: true }
}

export async function logout(event: H3Event) {
  const state = await loadAuthState()
  clearSessionCookie(event)
  return { hasPassword: Boolean(state?.passwordHash), authenticated: false }
}
