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

const BANNED_PHRASES = [
  '博主',
  '种草了',
  '笑死我了',
  '狠狠爱了',
  '刷到即缘分',
  '这BGM绝了',
  '有点东西',
  '这BGM有点上头',
  '有点意外',
  '有点上头啊',
  '绝了',
  '值这个价',
  '太丝滑了吧',
  '测评',
  '实测',
  '真实测评',
  '真实实测',
  '讲拍摄手法',
  '看完立马',
  '看完就搜',
  '刷到就看完',
  '不像广告',
  '广告吹得',
  '天花乱坠',
  '这帧率绝了',
  '开头那段绝了',
  '效果确实',
  '结果确实',
  '头皮真红',
  '头皮真红了',
  '这个运镜不错',
  '运镜不错',
  '运镜',
  '镜头语言',
  '画面语言',
  '构图',
  '剪辑',
  '机位',
  '转场',
  '景别',
  '分镜',
  '拍摄手法',
  '拍法',
  '镜头切',
  '镜头感',
  '画面构图',
  '节奏感'
] as const

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

function hasBannedPhrase(line: string) {
  return BANNED_PHRASES.some((phrase) => line.includes(phrase))
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
      const invalid = isBoilerplate(line) || hasBannedPhrase(line) || isInvalidLength(line)
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
