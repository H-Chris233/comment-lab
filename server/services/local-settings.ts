import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type LocalSettings = {
  aliyunApiKey?: string
  aliyunBaseUrl?: string
  pythonServiceUrl?: string
  aliyunModel?: string
  generateTimeoutMs?: number
  debugRawEnabled?: boolean
}

const SETTINGS_DIR = path.join(os.homedir(), '.comment-lab')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return undefined
  const next = value.trim()
  return next ? next : undefined
}

function sanitize(input: Partial<LocalSettings> | null | undefined): LocalSettings {
  const timeout = Number(input?.generateTimeoutMs)
  return {
    aliyunApiKey: normalizeString(input?.aliyunApiKey),
    aliyunBaseUrl: normalizeString(input?.aliyunBaseUrl),
    pythonServiceUrl: normalizeString(input?.pythonServiceUrl),
    aliyunModel: normalizeString(input?.aliyunModel),
    generateTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined,
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
  await fs.mkdir(SETTINGS_DIR, { recursive: true })
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}
