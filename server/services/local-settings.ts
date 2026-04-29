import { promises as fs } from 'node:fs'
import { createAppError } from '../utils/errors'
import { getSettingsDir, getSettingsFilePath, toActionableStorageError } from './app-paths'

export type LocalSettings = {
  aliyunApiKey?: string
  aliyunBaseUrl?: string
  tikhubApiKey?: string
  pythonServiceUrl?: string
  aliyunModel?: string
  debugRawEnabled?: boolean
}

const SETTINGS_DIR = getSettingsDir()
const SETTINGS_FILE = getSettingsFilePath()

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return undefined
  const next = value.trim()
  return next ? next : undefined
}

function sanitize(input: Partial<LocalSettings> | null | undefined): LocalSettings {
  return {
    aliyunApiKey: normalizeString(input?.aliyunApiKey),
    aliyunBaseUrl: normalizeString(input?.aliyunBaseUrl),
    tikhubApiKey: normalizeString(input?.tikhubApiKey),
    pythonServiceUrl: normalizeString(input?.pythonServiceUrl),
    aliyunModel: normalizeString(input?.aliyunModel),
    debugRawEnabled: typeof input?.debugRawEnabled === 'boolean' ? input.debugRawEnabled : undefined
  }
}

export async function readLocalSettings(): Promise<LocalSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8')
    return sanitize(JSON.parse(raw) as LocalSettings)
  } catch {
    return {}
  }
}

export async function writeLocalSettings(input: Partial<LocalSettings>): Promise<LocalSettings> {
  const current = await readLocalSettings()
  const next = sanitize({
    ...current,
    ...input
  })

  try {
    await fs.mkdir(SETTINGS_DIR, { recursive: true })
    await fs.chmod(SETTINGS_DIR, 0o700).catch(() => {})
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.chmod(SETTINGS_FILE, 0o600).catch(() => {})
    return next
  } catch (error) {
    const mapped = toActionableStorageError(error, 'SETTINGS_WRITE_FAILED', '设置保存失败')
    throw createAppError(mapped)
  }
}
