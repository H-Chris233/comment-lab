import {
  countAllowedEmoji,
  countEmojiSequences,
  countTextLengthWithoutEmoji,
  findAllowedEmojiMatches,
  keepAllowedEmojiBudget,
  stripAllEmoji
} from './emoji'

export interface NormalizeResult {
  comments: string[]
  beforeCount: number
  afterCount: number
  removedEmpty: number
  removedDuplicate: number
  removedInvalid: number
}

export type NormalizeOptions = {
  dedupe?: boolean
  cleanEmpty?: boolean
  emojiRatio?: number
  commaSpaceRatio?: number
  commaPeriodRatio?: number
  commaEmojiSwapRatio?: number
}

export const NORMALIZE_DEFAULT_RATIOS = {
  emojiRatio: 0.1,
  commaSpaceRatio: 0.3,
  commaPeriodRatio: 0.1,
  commaEmojiSwapRatio: 0.1
} as const

function removePrefix(line: string) {
  return line.replace(/^((?:\d+|[①②③④⑤⑥⑦⑧⑨⑩])[\.、\-\)]\s*|[-*•·>]\s*)/, '')
}

function normalizeSpaces(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

function normalizeBgm(line: string) {
  return line.replace(/BGM/gi, 'bgm')
}

function stripSentenceEndingPunctuation(line: string) {
  const ending = line.match(/[。．.!！？?]+$/)
  if (!ending) {
    return { line, ending: '' }
  }

  return {
    line: line.slice(0, -ending[0].length),
    ending: ending[0]
  }
}

function countCommas(line: string) {
  return (line.match(/，/g) || []).length
}

function findCommaIndices(line: string) {
  return Array.from(line.matchAll(/，/g), (match) => match.index ?? 0)
}

function swapOneCommaWithEmoji(line: string) {
  const emojiMatches = findAllowedEmojiMatches(line)
  const commaIndices = findCommaIndices(line)
  if (!emojiMatches.length || !commaIndices.length) return line

  const commaIndex = commaIndices[0]
  const emojiMatch = emojiMatches.reduce((best, current) => {
    if (!best) return current
    const bestDistance = Math.abs(best.index - commaIndex)
    const currentDistance = Math.abs(current.index - commaIndex)
    if (currentDistance !== bestDistance) return currentDistance < bestDistance ? current : best
    return current.index < best.index ? current : best
  }, null as (typeof emojiMatches)[number] | null)

  if (!emojiMatch) return line

  const removals = [
    { start: commaIndex, end: commaIndex + 1 },
    {
      start: emojiMatch.index,
      end: emojiMatch.index + emojiMatch.length
    }
  ].sort((a, b) => b.start - a.start)

  let output = line
  for (const removal of removals) {
    output = output.slice(0, removal.start) + output.slice(removal.end)
  }

  const insertPos = commaIndex - (emojiMatch.index < commaIndex ? emojiMatch.length : 0)
  return output.slice(0, insertPos) + emojiMatch.value + output.slice(insertPos)
}

function rewriteCommaBudget(line: string, keepSpaces: number, keepPeriods: number) {
  let spacesLeft = keepSpaces
  let periodsLeft = keepPeriods
  const terminalPunctuation = ['。', '！', '？']
  let terminalIndex = 0

  return line.replace(/，/g, () => {
    if (spacesLeft > 0) {
      spacesLeft -= 1
      return '  '
    }

    if (periodsLeft > 0) {
      periodsLeft -= 1
      const punctuation = terminalPunctuation[terminalIndex % terminalPunctuation.length]
      terminalIndex += 1
      return punctuation
    }

    return '，'
  })
}

function restoreSentenceEndingPunctuation(line: string, ending: string) {
  if (!ending) return line
  if (Math.random() < 0.5) return `${line}${ending}`
  return line
}

const BANNED_PHRASES = [
  '允许泛化',
  '博主',
  '种草',
  '笑死我了',
  '狠狠爱了',
  '刷到即缘分',
  'bgm',
  '这bgm绝了',
  '有点东西',
  '这bgm有点上头',
  '有点意外',
  '值这个价',
  '前面更好看',
  '怎么拍的？',
  '怎么拍的',
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

function isBundleHeading(line: string) {
  return /^[【\[\(]\s*\d+\s*字\s*[】\]\)]$/.test(line)
}

function isInvalidLength(line: string) {
  const visibleLength = countTextLengthWithoutEmoji(line)
  return visibleLength < 2 || visibleLength > 60
}

function isSingleEmojiLine(line: string) {
  if (countEmojiSequences(line) !== 1) return false
  const remainder = stripAllEmoji(line).replace(/[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]/g, '')
  return remainder.length === 0
}

function splitMergedLine(line: string) {
  return line
    .split(/(?<=[。！？!?；;])(?=[^\s。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function spreadCommentsByPrefix(comments: string[], prefixLength = 2) {
  if (!Array.isArray(comments) || comments.length <= 2 || prefixLength <= 0) {
    return Array.isArray(comments) ? [...comments] : []
  }

  const buckets: Array<{
    prefix: string
    items: string[]
    firstIndex: number
    cursor: number
  }> = []
  const bucketIndexByPrefix = new Map<string, number>()

  comments.forEach((comment, index) => {
    const text = String(comment)
    const prefix = text.trim().slice(0, prefixLength)
    const bucketIndex = bucketIndexByPrefix.get(prefix)

    if (bucketIndex == null) {
      bucketIndexByPrefix.set(prefix, buckets.length)
      buckets.push({
        prefix,
        items: [text],
        firstIndex: index,
        cursor: 0
      })
      return
    }

    buckets[bucketIndex].items.push(text)
  })

  if (buckets.length <= 1) return [...comments]

  const remaining = buckets.map((bucket) => bucket.items.length)
  const result: string[] = []
  let lastPrefix = ''

  const pickBestBucket = (allowLastPrefix: boolean) => {
    let bestIndex = -1

    for (let index = 0; index < buckets.length; index += 1) {
      if (remaining[index] <= 0) continue
      if (!allowLastPrefix && buckets[index].prefix === lastPrefix) continue

      if (
        bestIndex === -1 ||
        remaining[index] > remaining[bestIndex] ||
        (remaining[index] === remaining[bestIndex] && buckets[index].firstIndex < buckets[bestIndex].firstIndex)
      ) {
        bestIndex = index
      }
    }

    return bestIndex
  }

  while (result.length < comments.length) {
    let bucketIndex = pickBestBucket(false)
    if (bucketIndex === -1) bucketIndex = pickBestBucket(true)
    if (bucketIndex === -1) break

    const bucket = buckets[bucketIndex]
    const item = bucket.items[bucket.cursor]
    bucket.cursor += 1
    remaining[bucketIndex] -= 1
    result.push(item)
    lastPrefix = bucket.prefix
  }

  return result.length === comments.length ? result : [...comments]
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

function applyEmojiRatio(lines: string[], ratio: number = NORMALIZE_DEFAULT_RATIOS.emojiRatio) {
  if (!lines.length) return lines

  const lineMeta = lines.map((line, index) => {
    const emojiCount = countAllowedEmoji(line)
    return { line, index, emojiCount, keep: 0, remainder: 0 }
  })

  const totalEmojiCount = lineMeta.reduce((sum, item) => sum + item.emojiCount, 0)
  if (totalEmojiCount <= 0) return lines.map((line) => stripAllEmoji(line))

  const calculatedBudget = Math.max(0, Math.round(lines.length * ratio))
  const totalBudget = calculatedBudget > 0 ? calculatedBudget : 1
  if (totalBudget <= 0) return lines.map((line) => stripAllEmoji(line))

  for (const item of lineMeta) {
    const exact = (totalBudget * item.emojiCount) / totalEmojiCount
    const base = Math.floor(exact)
    item.keep = Math.min(item.emojiCount, base)
    item.remainder = exact - base
  }

  let remaining = totalBudget - lineMeta.reduce((sum, item) => sum + item.keep, 0)
  const ranked = [...lineMeta].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder
    if (b.emojiCount !== a.emojiCount) return b.emojiCount - a.emojiCount
    return a.index - b.index
  })

  for (const item of ranked) {
    if (remaining <= 0) break
    if (item.keep >= item.emojiCount) continue
    item.keep += 1
    remaining -= 1
  }

  return lineMeta
    .sort((a, b) => a.index - b.index)
    .map((item) => keepAllowedEmojiBudget(item.line, item.keep))
}

function applyCommaRatio(
  lines: string[],
  spaceRatio: number = NORMALIZE_DEFAULT_RATIOS.commaSpaceRatio,
  periodRatio: number = NORMALIZE_DEFAULT_RATIOS.commaPeriodRatio
) {
  if (!lines.length) return lines

  const totalCommas = lines.reduce((sum, line) => sum + countCommas(line), 0)
  if (totalCommas <= 0) return lines

  const spaceBudget = Math.max(0, Math.floor(totalCommas * spaceRatio))
  const periodBudget = Math.max(0, Math.floor(totalCommas * periodRatio))

  const lineMeta = lines.map((line, index) => {
    const commaCount = countCommas(line)
    const exactSpace = commaCount > 0 ? (spaceBudget * commaCount) / totalCommas : 0
    const exactPeriod = commaCount > 0 ? (periodBudget * commaCount) / totalCommas : 0
    return {
      line,
      index,
      commaCount,
      keepSpaces: Math.min(commaCount, Math.floor(exactSpace)),
      keepPeriods: 0,
      spaceRemainder: exactSpace - Math.floor(exactSpace),
      periodRemainder: exactPeriod - Math.floor(exactPeriod)
    }
  })

  let remainingSpaces = spaceBudget - lineMeta.reduce((sum, item) => sum + item.keepSpaces, 0)
  let remainingPeriods = periodBudget

  const bySpace = [...lineMeta].sort((a, b) => {
    if (b.spaceRemainder !== a.spaceRemainder) return b.spaceRemainder - a.spaceRemainder
    if (b.commaCount !== a.commaCount) return b.commaCount - a.commaCount
    return a.index - b.index
  })

  for (const item of bySpace) {
    if (remainingSpaces <= 0) break
    if (item.keepSpaces >= item.commaCount) continue
    item.keepSpaces += 1
    remainingSpaces -= 1
  }

  const byPeriod = [...lineMeta].sort((a, b) => {
    if (b.periodRemainder !== a.periodRemainder) return b.periodRemainder - a.periodRemainder
    if (b.commaCount !== a.commaCount) return b.commaCount - a.commaCount
    return a.index - b.index
  })

  for (const item of byPeriod) {
    if (remainingPeriods <= 0) break
    const available = item.commaCount - item.keepSpaces - item.keepPeriods
    if (available <= 0) continue
    item.keepPeriods += 1
    remainingPeriods -= 1
  }

  return lineMeta
    .sort((a, b) => a.index - b.index)
    .map((item) => rewriteCommaBudget(item.line, item.keepSpaces, item.keepPeriods))
}

function applyEmojiCommaSwap(
  lines: string[],
  ratio: number = NORMALIZE_DEFAULT_RATIOS.commaEmojiSwapRatio
) {
  if (!lines.length) return lines

  const eligible = lines
    .map((line, index) => ({
      line,
      index,
      emojiCount: countAllowedEmoji(line),
      commaCount: countCommas(line)
    }))
    .filter((item) => item.emojiCount > 0 && item.commaCount > 0)

  if (!eligible.length) return lines

  const budget = Math.max(0, Math.round(eligible.length * ratio))
  if (budget <= 0) return lines

  const selected = new Set<number>()
  const sorted = [...eligible].sort((a, b) => {
    if (b.commaCount !== a.commaCount) return b.commaCount - a.commaCount
    if (b.emojiCount !== a.emojiCount) return b.emojiCount - a.emojiCount
    return a.index - b.index
  })

  for (const item of sorted) {
    if (selected.size >= budget) break
    selected.add(item.index)
  }

  return lines.map((line, index) => (selected.has(index) ? swapOneCommaWithEmoji(line) : line))
}

function normalizeFromLines(originalLines: string[], options?: NormalizeOptions): NormalizeResult {
  const dedupe = options?.dedupe ?? true
  const cleanEmpty = options?.cleanEmpty ?? true
  const emojiRatio = options?.emojiRatio ?? NORMALIZE_DEFAULT_RATIOS.emojiRatio
  const commaSpaceRatio = options?.commaSpaceRatio ?? NORMALIZE_DEFAULT_RATIOS.commaSpaceRatio
  const commaPeriodRatio = options?.commaPeriodRatio ?? NORMALIZE_DEFAULT_RATIOS.commaPeriodRatio
  const commaEmojiSwapRatio = options?.commaEmojiSwapRatio ?? NORMALIZE_DEFAULT_RATIOS.commaEmojiSwapRatio

  let removedEmpty = 0
  let removedInvalid = 0
  let removedDuplicate = 0

  const normalized = originalLines
    .map((line) => String(line).trim())
    .map(removePrefix)
    .map(stripMetaLeadIn)
    .map(removePrefix)
    .map(normalizeBgm)
    .map(normalizeSpaces)
    .map(stripSentenceEndingPunctuation)
    .filter((line) => {
      if (!cleanEmpty) return true
      const keep = Boolean(line.line)
      if (!keep) removedEmpty += 1
      return keep
    })
    .filter((line) => {
      const invalid = isBoilerplate(line.line) || hasBannedPhrase(line.line) || isBundleHeading(line.line) || isInvalidLength(line.line) || isSingleEmojiLine(line.line)
      if (invalid) removedInvalid += 1
      return !invalid
    })

  let comments = normalized

  if (dedupe) {
    const seen = new Set<string>()
    comments = normalized.filter((line) => {
      if (seen.has(line.line)) {
        removedDuplicate += 1
        return false
      }
      seen.add(line.line)
      return true
    })
  }

  let commentLines = comments.map((item) => item.line)
  commentLines = applyEmojiRatio(commentLines, emojiRatio)
  commentLines = applyEmojiCommaSwap(commentLines, commaEmojiSwapRatio)
  commentLines = applyCommaRatio(commentLines, commaSpaceRatio, commaPeriodRatio)
  comments = comments.map((item, index) => ({
    ...item,
    line: commentLines[index] || item.line
  }))
  comments = comments.map((item) => ({
    ...item,
    line: restoreSentenceEndingPunctuation(item.line, item.ending)
  }))

  return {
    comments: comments.map((item) => item.line),
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
