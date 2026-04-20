export interface NormalizeResult {
  comments: string[]
  beforeCount: number
  afterCount: number
  removedEmpty: number
  removedDuplicate: number
  removedInvalid: number
}

type NormalizeOptions = { dedupe?: boolean; cleanEmpty?: boolean }

function removePrefix(line: string) {
  return line.replace(/^(\d+[\.、\-\)]\s*)/, '')
}

function normalizeSpaces(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

function stripSentenceEndingPeriod(line: string, index: number) {
  if (!/[。．.]$/.test(line)) return line
  return line.replace(/[。．.]+$/, '')
}

function isBoilerplate(line: string) {
  const lower = line.toLowerCase()
  return [
    '以下是评论',
    '评论如下',
    '好的，以下内容是',
    '好的以下内容是',
    '以下内容是'
  ].some((word) => lower.includes(word))
}

function isInvalidLength(line: string) {
  return line.length < 2 || line.length > 60
}

function normalizeFromLines(originalLines: string[], options?: NormalizeOptions): NormalizeResult {
  const dedupe = options?.dedupe ?? true
  const cleanEmpty = options?.cleanEmpty ?? true

  let removedEmpty = 0
  let removedInvalid = 0
  let removedDuplicate = 0

  const normalized = originalLines
    .map((line) => removePrefix(String(line).trim()))
    .map(normalizeSpaces)
    .map(stripSentenceEndingPeriod)
    .filter((line) => {
      if (!cleanEmpty) return true
      const keep = Boolean(line)
      if (!keep) removedEmpty += 1
      return keep
    })
    .filter((line) => {
      const invalid = isBoilerplate(line) || isInvalidLength(line)
      if (invalid) removedInvalid += 1
      return !invalid
    })

  let comments = normalized

  if (dedupe) {
    const seen = new Set<string>()
    comments = normalized.filter((line) => {
      if (seen.has(line)) {
        removedDuplicate += 1
        return false
      }
      seen.add(line)
      return true
    })
  }

  return {
    comments,
    beforeCount: originalLines.length,
    afterCount: comments.length,
    removedEmpty,
    removedDuplicate,
    removedInvalid
  }
}

export function normalizeComments(raw: string, options?: NormalizeOptions): NormalizeResult {
  return normalizeFromLines(raw.split(/\r?\n/), options)
}
