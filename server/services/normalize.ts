import {
  countEmojiSequences,
  endsWithEmojiSequence,
  countVisibleLengthWithoutEmojiAndPunctuation,
  findEmojiMatches,
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
  emojiRatio: 0.15,
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
  return `${line}${ending}`
}

function stripTerminalPunctuation(line: string) {
  return line.replace(/[。．.!！？?]+$/u, '')
}

function normalizeRatio(ratio: number) {
  if (!Number.isFinite(ratio)) return 0
  const normalized = ratio > 1 ? ratio / 100 : ratio
  return Math.min(1, Math.max(0, normalized))
}

const LEADING_PUNCTUATION_RE = /^[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》/\\]+/u

function splitLeadingDecorators(line: string) {
  let value = line.trim()
  let prefix = ''

  while (true) {
    const before = value
    const punctuation = value.match(LEADING_PUNCTUATION_RE)
    if (punctuation) {
      prefix += punctuation[0]
      value = value.slice(punctuation[0].length)
    }

    const emoji = findEmojiMatches(value)[0]
    if (emoji && emoji.index === 0) {
      prefix += emoji.value
      value = value.slice(emoji.length)
    }

    if (value === before) break
  }

  return { prefix, core: value }
}

function splitByRatio(total: number, ratios: number[]) {
  if (total <= 0 || !ratios.length) return ratios.map(() => 0)

  const normalizedTotal = ratios.reduce((sum, ratio) => sum + ratio, 0)
  const exactEntries = ratios.map((ratio, index) => {
    const exact = (total * ratio) / normalizedTotal
    const count = Math.floor(exact)
    return { index, count, remainder: exact - count }
  })

  let remaining = total - exactEntries.reduce((sum, entry) => sum + entry.count, 0)
  const ranked = [...exactEntries].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder
    return a.index - b.index
  })

  for (const entry of ranked) {
    if (remaining <= 0) break
    entry.count += 1
    remaining -= 1
  }

  return exactEntries.map((entry) => entry.count)
}

function applyTerminalDistribution(
  lines: string[],
  endings: string[],
  punctuationRatio: number = 0.7
) {
  if (!lines.length) return lines

  const total = lines.length
  const [_, punctuationTarget, plainTarget] = splitByRatio(total, [
    0,
    punctuationRatio,
    Math.max(0, 1 - punctuationRatio)
  ])

  const punctuationIndices = lines
    .map((line, index) => ({
      line,
      index,
      punctuationCount: (line.match(/[。．.!！？?]+$/gu) || []).length
    }))
    .sort((a, b) => {
      if (b.punctuationCount !== a.punctuationCount) return b.punctuationCount - a.punctuationCount
      return a.index - b.index
    })
    .slice(0, punctuationTarget)
    .map((item) => item.index)

  const punctuationIndexSet = new Set<number>(punctuationIndices)

  return lines.map((line, index) => {
    if (punctuationIndexSet.has(index)) {
      const base = stripTerminalPunctuation(line).trim()
      const ending = endings[index] || '。'
      return restoreSentenceEndingPunctuation(base, ending)
    }

    return stripTerminalPunctuation(line).trim()
  }).slice(0, plainTarget + punctuationTarget)
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
  const visibleLength = countVisibleLengthWithoutEmojiAndPunctuation(line)
  return visibleLength < 2 || visibleLength > 30
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

  const normalizePrefixSource = (value: string) => {
    return stripAllEmoji(String(value).trim())
      .replace(/^[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》/\\]+/gu, '')
      .trim()
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
    const prefix = normalizePrefixSource(text).slice(0, prefixLength)
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

function applyEmojiCommaSwap(lines: string[]) {
  return lines
}

function hasCommaSeparator(line: string) {
  return /[，,]/.test(line)
}

function replaceCommaNearMiddle(line: string, emoji: string) {
  const matches = Array.from(line.matchAll(/[，,]/g))
  if (!matches.length) return line

  const midpoint = line.length / 2
  const target = matches.reduce<RegExpMatchArray | null>((best, current) => {
    if (!best) return current

    const bestIndex = best.index ?? 0
    const currentIndex = current.index ?? 0
    const bestDistance = Math.abs(bestIndex - midpoint)
    const currentDistance = Math.abs(currentIndex - midpoint)

    if (currentDistance !== bestDistance) {
      return currentDistance < bestDistance ? current : best
    }

    return currentIndex < bestIndex ? current : best
  }, null)

  if (!target) return line

  const targetIndex = target.index ?? 0
  return `${line.slice(0, targetIndex)}${emoji}${line.slice(targetIndex + target[0].length)}`
}

function applyEmojiDistribution(lines: string[], emojiRatio: number = NORMALIZE_DEFAULT_RATIOS.emojiRatio) {
  if (!lines.length) return lines

  const normalizedRatio = normalizeRatio(emojiRatio)
  const targetEmojiCount = Math.min(lines.length, Math.max(0, Math.round(lines.length * normalizedRatio)))
  if (targetEmojiCount <= 0) return lines.map((line) => stripAllEmoji(line))

  const emojiPool = lines.flatMap((line) => findEmojiMatches(line).map((match) => match.value))
  if (!emojiPool.length) return lines.map((line) => stripAllEmoji(line))

  const [frontTarget, middleTarget, tailTarget] = splitByRatio(targetEmojiCount, [1, 1, 1])
  const selected = new Set<number>()
  const assignments: Array<{ index: number, placement: 'front' | 'middle' | 'tail' }> = []

  const take = (indices: number[], targetCount: number, placement: 'front' | 'middle' | 'tail') => {
    let picked = 0
    for (const index of indices) {
      if (picked >= targetCount) break
      if (selected.has(index)) continue

      selected.add(index)
      assignments.push({ index, placement })
      picked += 1
    }

    return picked
  }

  const frontPicked = take([...lines.keys()], frontTarget, 'front')
  const middleCandidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !selected.has(index) && hasCommaSeparator(line))
    .map(({ index }) => index)
  const middlePicked = take(middleCandidates, middleTarget, 'middle')
  const middleDeficit = middleTarget - middlePicked

  const tailCandidates = [...lines.keys()].reverse()
  take(tailCandidates, tailTarget + middleDeficit + Math.max(0, frontTarget - frontPicked), 'tail')

  if (!assignments.length) return lines.map((line) => stripAllEmoji(line))

  const transformed = lines.map((line) => stripAllEmoji(line))

  assignments.forEach((assignment, slotIndex) => {
    const emoji = emojiPool[slotIndex % emojiPool.length]
    const base = stripSentenceEndingPunctuation(transformed[assignment.index]).line.trim()
    let nextLine = base

    if (assignment.placement === 'front') {
      nextLine = `${emoji}${base}`
    } else if (assignment.placement === 'middle') {
      const middleLine = replaceCommaNearMiddle(base, emoji)
      nextLine = middleLine === base ? `${base}${emoji}` : middleLine
    } else {
      nextLine = `${base}${emoji}`
    }

    transformed[assignment.index] = stripSentenceEndingPunctuation(nextLine).line.trim()
  })

  return transformed
}

function stripLeadingDiscoursePrefix(line: string, prefixes: string[]) {
  const { prefix, core } = splitLeadingDecorators(line)
  const matchedPrefix = prefixes.find((item) => core.startsWith(item))
  if (!matchedPrefix) return line

  return `${prefix}${core.slice(matchedPrefix.length).replace(LEADING_PUNCTUATION_RE, '')}`.trim()
}

function applyLeadingDiscoursePrefixBudget(lines: string[], prefixes: string[], ratio: number = 0.03) {
  if (!lines.length) return lines

  const normalizedRatio = normalizeRatio(ratio)
  const allowedCount = Math.min(lines.length, Math.max(0, Math.round(lines.length * normalizedRatio)))
  if (allowedCount <= 0) {
    return lines.map((line) => stripLeadingDiscoursePrefix(line, prefixes))
  }

  const decorated = lines.map((line, index) => {
    const parts = splitLeadingDecorators(line)
    return {
      index,
      ...parts,
      hasDiscoursePrefix: prefixes.some((item) => parts.core.startsWith(item))
    }
  })

  const discoursePrefixIndices = decorated.filter((item) => item.hasDiscoursePrefix).map((item) => item.index)
  if (discoursePrefixIndices.length <= allowedCount) return lines

  const keepSet = new Set(discoursePrefixIndices.slice(0, allowedCount))

  return decorated.map((item) => {
    if (!item.hasDiscoursePrefix || keepSet.has(item.index)) return lines[item.index]
    return stripLeadingDiscoursePrefix(lines[item.index], prefixes)
  })
}

function stripSentenceEndingPunctuationWhenEndingWithEmoji(line: string) {
  const { line: strippedLine, ending } = stripSentenceEndingPunctuation(line)
  if (!ending) return line
  if (!endsWithEmojiSequence(strippedLine.trim())) return line

  return strippedLine.trim()
}

function normalizeFromLines(originalLines: string[], options?: NormalizeOptions): NormalizeResult {
  const dedupe = options?.dedupe ?? true
  const cleanEmpty = options?.cleanEmpty ?? true
  const emojiRatio = options?.emojiRatio ?? NORMALIZE_DEFAULT_RATIOS.emojiRatio
  const commaSpaceRatio = options?.commaSpaceRatio ?? NORMALIZE_DEFAULT_RATIOS.commaSpaceRatio
  const commaPeriodRatio = options?.commaPeriodRatio ?? NORMALIZE_DEFAULT_RATIOS.commaPeriodRatio

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
  commentLines = applyEmojiCommaSwap(commentLines)
  commentLines = applyCommaRatio(commentLines, commaSpaceRatio, commaPeriodRatio)
  const endings = comments.map((item) => item.ending)
  commentLines = applyTerminalDistribution(commentLines, endings, 0.7)
  commentLines = applyEmojiDistribution(commentLines, emojiRatio)
  commentLines = applyLeadingDiscoursePrefixBudget(commentLines, ['那个', '这个'], 0.03)
  commentLines = commentLines.map((line) => stripSentenceEndingPunctuationWhenEndingWithEmoji(line))
  comments = comments.map((item, index) => ({
    ...item,
    line: commentLines[index] || item.line
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
