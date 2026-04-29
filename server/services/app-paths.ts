import os from 'node:os'
import path from 'node:path'

const DEFAULT_APP_HOME = path.join(os.homedir(), '.comment-lab')

function normalizeAbsolutePath(value: unknown) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
}

function getAppHomeDir() {
  return normalizeAbsolutePath(process.env.COMMENT_LAB_APP_HOME)
    || normalizeAbsolutePath(process.env.COMMENT_LAB_APP_DATA_DIR)
    || DEFAULT_APP_HOME
}

export function getSettingsDir() {
  return normalizeAbsolutePath(process.env.COMMENT_LAB_CONFIG_DIR) || getAppHomeDir()
}

export function getSettingsFilePath() {
  return path.join(getSettingsDir(), 'settings.json')
}

export function getTempVideoDir() {
  return normalizeAbsolutePath(process.env.TEMP_VIDEO_DIR)
    || path.join(getAppHomeDir(), 'temp-video')
}

export function getAppLogDir() {
  return normalizeAbsolutePath(process.env.COMMENT_LAB_LOG_DIR)
    || path.join(getAppHomeDir(), 'logs')
}

export function toActionableStorageError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const e = error as NodeJS.ErrnoException
  const code = (e?.code || '').toUpperCase()

  if (code === 'EACCES' || code === 'EPERM') {
    return {
      code: 'STORAGE_PERMISSION_DENIED',
      message: '本地目录无写入权限，请在设置中检查目录权限后重试',
      statusCode: 507,
      data: {
        fallbackCode,
        reason: fallbackMessage
      }
    }
  }

  if (code === 'ENOSPC') {
    return {
      code: 'STORAGE_DISK_FULL',
      message: '磁盘空间不足，请释放空间后重试',
      statusCode: 507,
      data: {
        fallbackCode,
        reason: fallbackMessage
      }
    }
  }

  if (code === 'ENOENT') {
    return {
      code: 'STORAGE_PATH_MISSING',
      message: '本地目录不存在，请重新打开应用后重试',
      statusCode: 507,
      data: {
        fallbackCode,
        reason: fallbackMessage
      }
    }
  }

  return {
    code: fallbackCode,
    message: fallbackMessage,
    statusCode: 500,
    data: {
      reason: e?.message || 'unknown'
    }
  }
}
