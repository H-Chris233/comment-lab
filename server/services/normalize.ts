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
  return line.replace(/^((?:\d+|[①②③④⑤⑥⑦⑧⑨⑩])[\.、\-\)]\s*|[-*•·>]\s*)/, '')
}

function normalizeSpaces(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

function stripSentenceEndingPeriod(line: string) {
  if (!/[。．.]$/.test(line)) return line
  return line.replace(/[。．.]+$/, '')
}

const CONTENT_PREFIXES = [
  /^下面是/,
  /^以下是/,
  /^下面列出/,
  /^以下内容/,
  /^评论如下/,
  /^根据视频内容[,:：]?/,
  /^基于视频内容[,:：]?/
] as const

const DROP_PREFIXES = [
  /^仅供参考/,
  /^供参考/,
  /^总结[:：]?/,
  /^说明[:：]?/,
  /^分析[:：]?/,
  /^解析[:：]?/,
  /^输出格式[:：]?/,
  /^执行命令[:：]?/,
  /^核心约束[:：]?/,
  /^长度规范[:：]?/,
  /^任务[:：]?/,
  /^角色[:：]?/,
  /^上下文[:：]?/,
  /^附加提示词[:：]?/,
  /^视频标题[:：]?/,
  /^我整理的评论[:：]?/,
  /^我整理的[:：]?评论/
] as const

function stripMetaLeadIn(line: string) {
  for (const pattern of DROP_PREFIXES) {
    const match = line.match(pattern)
    if (!match) continue

    return ''
  }

  for (const pattern of CONTENT_PREFIXES) {
    const match = line.match(pattern)
    if (!match) continue

    const remainder = line.slice(match[0].length).trim()
    if (!remainder) return ''

    return remainder.replace(/^[:：,，、\-\s]+/, '').trim()
  }

  return line
}

function isBoilerplate(line: string) {
  const lower = line.toLowerCase()
  return [
    '以下是评论',
    '评论如下',
    '好的，以下内容是',
    '好的以下内容是',
    '以下内容是',
    '每条评论独占一行',
    '纯文本',
    '无编号',
    '无标题',
    '无引导语',
    '无解释',
    '输出格式',
    '执行命令',
    '核心约束',
    '长度规范',
    '附加提示词',
    '视频标题',
    '我整理的评论',
    '我整理的'
  ].some((word) => lower.includes(word))
}

function isInvalidLength(line: string) {
  return line.length < 2 || line.length > 60
}

function splitMergedLine(line: string) {
  return line
    .split(/(?<=[。！？!?；;])(?=[^\s。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function expandRawLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      if (!line) return ['']
      if (/^```/.test(line)) return []
      return splitMergedLine(line)
    })
}

function normalizeFromLines(originalLines: string[], options?: NormalizeOptions): NormalizeResult {
  const dedupe = options?.dedupe ?? true
  const cleanEmpty = options?.cleanEmpty ?? true

  let removedEmpty = 0
  let removedInvalid = 0
  let removedDuplicate = 0

  const normalized = originalLines
    .map((line) => String(line).trim())
    .map(removePrefix)
    .map(stripMetaLeadIn)
    .map(removePrefix)
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
  return normalizeFromLines(expandRawLines(raw), options)
}
