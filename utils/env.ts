const TRUE_SET = new Set(['1', 'true', 'yes', 'on'])

export function parseBooleanEnv(value?: string | null) {
  if (!value) return false
  return TRUE_SET.has(value.trim().toLowerCase())
}

export function shouldShowDebugRaw(debugEnabled: boolean, rawText?: string) {
  return Boolean(debugEnabled && rawText && rawText.trim())
}
