import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildPromptParams } from '../../types/prompt'
import { ALLOWED_EMOJI_TEXT } from './emoji'

export type CommentStyle = 'long' | 'medium' | 'short'

export const STYLE_ORDER: CommentStyle[] = ['short', 'medium', 'long']

export const STYLE_RATIOS: Record<CommentStyle, number> = {
  short: 0.4,
  medium: 0.4,
  long: 0.2
}

const LENGTH_BUCKET_RATIOS: Record<LengthBucketKey, number> = {
  short_1: 0.1,
  short_2: 0.12,
  medium_1: 0.18,
  medium_2: 0.2,
  long_1: 0.22,
  long_2: 0.18
}

const STYLE_DEFAULT_RANGES: Record<CommentStyle, string> = {
  short: '3~10字',
  medium: '10~25字',
  long: '25~35字'
}

const STYLE_DEFAULT_SUBRANGES: Record<CommentStyle, string> = {
  short: '3、4、5、6、7、8、9、10 这些字数点都要尽量覆盖，避免只集中在 6/7 这类常见字数',
  medium: '10~12、13~15、16~18、19~21、22~25 这些子区间都要尽量覆盖，避免只集中在 13/14 或 16/17 这类常见字数',
  long: '25~27、28~30、31~33、34~35 这些子区间都要尽量覆盖，避免只集中在 26/27 或 31/32 这类常见字数'
}

const TEMPLATE_CACHE = new Map<CommentStyle, string>()
const BUNDLE_TEMPLATE_CACHE = new Map<string, string>()

export type LengthBucketKey =
  | 'short_1'
  | 'short_2'
  | 'medium_1'
  | 'medium_2'
  | 'long_1'
  | 'long_2'

export type LengthBucketConfig = {
  key: LengthBucketKey
  style: CommentStyle
  label: string
  range: string
  subranges: string
}

export const LENGTH_BUCKET_ORDER: LengthBucketKey[] = [
  'short_1',
  'short_2',
  'medium_1',
  'medium_2',
  'long_1',
  'long_2'
]

export const LENGTH_BUCKETS: Record<LengthBucketKey, LengthBucketConfig> = {
  short_1: { key: 'short_1', style: 'short', label: '短评论桶 A', range: '3~5字', subranges: '3、4、5 这几个字数点都要尽量覆盖，避免只集中在 3/4 这类常见字数' },
  short_2: { key: 'short_2', style: 'short', label: '短评论桶 B', range: '6~10字', subranges: '6、7、8、9、10 这几个字数点都要尽量覆盖，避免只集中在 6/7 这类常见字数' },
  medium_1: { key: 'medium_1', style: 'medium', label: '中评论桶 A', range: '10~15字', subranges: '10~12、13~15 这两个子区间都要尽量覆盖，避免只集中在 13/14 这类常见字数' },
  medium_2: { key: 'medium_2', style: 'medium', label: '中评论桶 B', range: '16~20字', subranges: '16~18、19~20 这两个子区间都要尽量覆盖，避免只集中在 16/17 这类常见字数' },
  long_1: { key: 'long_1', style: 'long', label: '长评论桶 A', range: '21~27字', subranges: '21~24、25~27 这两个子区间都要尽量覆盖，避免只集中在 26/27 这类常见字数' },
  long_2: { key: 'long_2', style: 'long', label: '长评论桶 B', range: '28~35字', subranges: '28~31、32~35 这两个子区间都要尽量覆盖，避免只集中在 31/32 这类常见字数' }
}

export const EXACT_LENGTH_MIN = 5
export const EXACT_LENGTH_MAX = 27

export type ExactLengthTarget = {
  length: number
  target: number
}

export type ExactLengthBundle = {
  index: number
  lengths: ExactLengthTarget[]
  total: number
  range: string
  label: string
  targetLines: string
}

function templatePath(style: CommentStyle) {
  return join(process.cwd(), 'prompts', `${style}.txt`)
}

async function loadTemplate(style: CommentStyle) {
  const cached = TEMPLATE_CACHE.get(style)
  if (cached) return cached

  const template = await readFile(templatePath(style), 'utf8')
  TEMPLATE_CACHE.set(style, template)
  return template
}

function bundleTemplatePath() {
  return join(process.cwd(), 'prompts', 'bundle.txt')
}

async function loadBundleTemplate() {
  const cacheKey = 'bundle'
  const cached = BUNDLE_TEMPLATE_CACHE.get(cacheKey)
  if (cached) return cached

  const template = await readFile(bundleTemplatePath(), 'utf8')
  BUNDLE_TEMPLATE_CACHE.set(cacheKey, template)
  return template
}

function renderTemplate(template: string, params: BuildPromptParams, target: number) {
  const basePrompt = params.basePrompt.trim()
  const promptSection = basePrompt ? `附加提示词：\n${basePrompt}` : ''
  const title = params.title?.trim()
  const titleSection = title ? `视频标题：${sanitizePromptText(title)}` : ''
  const commentSamples = normalizeCommentSamples(params.commentSamples)
  const sampleSection = commentSamples.length
    ? `评论样本（仅供模仿语气、句式和节奏，不要照抄）：\n${commentSamples.map((sample) => `- ${sample}`).join('\n')}`
    : ''
  const bucketLabel = params.lengthBucket?.trim()
  const bucketRange = params.lengthRange?.trim()
  const bucketSubranges = params.lengthSubranges?.trim() || ''
  const bucketRuleText = bucketRange
    ? (/[~～\-—]/.test(bucketRange)
        ? `每条评论字数严格限定在 ${bucketRange} 之间，且需在以下子区间内分布：${bucketSubranges}。长度需自然参差。`
        : `每条评论字数严格限定在 ${bucketRange}，长度需自然参差。`)
    : ''
  const bucketSection = bucketLabel && bucketRange
    ? `当前长度桶：${bucketLabel}\n本轮只生成 ${bucketRange} 的评论，长度要在该桶内分散，不要挤在常见字数点。`
    : ''
  const contextSection = [titleSection, bucketSection, sampleSection, promptSection].filter(Boolean).join('\n')

  return template
    .replaceAll('{{PROMPT_SECTION}}', contextSection)
    .replaceAll('{{CONTEXT_SECTION}}', contextSection)
    .replaceAll('{{BUCKET_LABEL}}', bucketLabel || '')
    .replaceAll('{{BUCKET_RANGE}}', bucketRange || '')
    .replaceAll('{{BUCKET_SUBRANGES}}', bucketSubranges)
    .replaceAll('{{BUCKET_RULE_TEXT}}', bucketRuleText)
    .replaceAll('{{EMOJI_LIST}}', ALLOWED_EMOJI_TEXT)
    .replaceAll('{{STYLE_TARGET}}', String(target))
}

function sanitizePromptText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function normalizeCommentSamples(samples?: string[]) {
  if (!Array.isArray(samples) || !samples.length) return []

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const sample of samples) {
    const text = sanitizeCommentSample(sample)
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
    if (normalized.length >= 8) break
  }

  return normalized
}

function sanitizeCommentSample(value: string) {
  return value
    .replace(/^[\s\-•·\d.)、：:]+/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function splitByRatio(total: number) {
  const exactEntries = STYLE_ORDER.map((style, index) => {
    const exact = total * STYLE_RATIOS[style]
    const count = Math.floor(exact)
    return {
      style,
      index,
      count,
      remainder: exact - count
    }
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

  return exactEntries.reduce<Record<CommentStyle, number>>((acc, entry) => {
    acc[entry.style] = entry.count
    return acc
  }, { long: 0, medium: 0, short: 0 })
}

function splitByCustomRatio<T extends string>(
  total: number,
  order: readonly T[],
  ratios: Record<T, number>
) {
  const exactEntries = order.map((key, index) => {
    const exact = total * ratios[key]
    const count = Math.floor(exact)
    return {
      key,
      index,
      count,
      remainder: exact - count
    }
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

  return exactEntries.reduce<Record<T, number>>((acc, entry) => {
    acc[entry.key] = entry.count
    return acc
  }, Object.fromEntries(order.map((key) => [key, 0])) as Record<T, number>)
}

export function splitStyleTargets(total: number) {
  if (total <= 0) {
    return { long: 0, medium: 0, short: 0 }
  }

  return splitByRatio(total)
}

export function splitLengthBucketTargets(total: number) {
  return splitByCustomRatio(total, LENGTH_BUCKET_ORDER, LENGTH_BUCKET_RATIOS)
}

export function splitExactLengthTargets(
  total: number,
  minLength = EXACT_LENGTH_MIN,
  maxLength = EXACT_LENGTH_MAX
) {
  if (total <= 0 || maxLength < minLength) return []

  const lengths = Array.from({ length: maxLength - minLength + 1 }, (_, index) => minLength + index)
  const exactEntries = lengths.map((length, index) => {
    const exact = total / lengths.length
    const count = Math.floor(exact)
    return {
      length,
      index,
      count,
      remainder: exact - count
    }
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

  return exactEntries.map(({ length, count }) => ({ length, target: count }))
}

export function splitExactLengthTargetBundles(
  targets: ExactLengthTarget[],
  bundleSize = 5
) {
  if (!Array.isArray(targets) || !targets.length || bundleSize <= 0) return []

  const sortedTargets = [...targets].sort((a, b) => a.length - b.length)
  const bundles: ExactLengthBundle[] = []

  for (let index = 0; index < sortedTargets.length; index += bundleSize) {
    const lengths = sortedTargets.slice(index, index + bundleSize)
    if (!lengths.length) continue

    const first = lengths[0]?.length || 0
    const last = lengths[lengths.length - 1]?.length || first
    const total = lengths.reduce((sum, item) => sum + item.target, 0)
    const targetLines = lengths.map((item) => `${item.length}字 ${item.target}条`).join('、')

    bundles.push({
      index: bundles.length + 1,
      lengths,
      total,
      range: first === last ? `${first}字` : `${first}~${last}字`,
      label: `Bundle ${bundles.length + 1}`,
      targetLines
    })
  }

  return bundles
}

export async function buildStylePrompt(style: CommentStyle, params: BuildPromptParams, target: number) {
  const template = await loadTemplate(style)
  return renderTemplate(template, {
    ...params,
    lengthRange: params.lengthRange || STYLE_DEFAULT_RANGES[style],
    lengthSubranges: params.lengthSubranges || STYLE_DEFAULT_SUBRANGES[style]
  }, target)
}

export async function buildExactLengthPrompt(
  length: number,
  params: BuildPromptParams,
  target: number
) {
  const style: CommentStyle = length <= 10 ? 'short' : length <= 18 ? 'medium' : 'long'
  const template = await loadTemplate(style)
  return renderTemplate(template, {
    ...params,
    lengthBucket: `精确长度 ${length} 字`,
    lengthRange: `${length}字`,
    lengthSubranges: `${length}字`
  }, target)
}

export async function buildExactLengthPrompts(
  params: BuildPromptParams,
  targets: ExactLengthTarget[]
) {
  const entries = await Promise.all(
    targets
      .filter(({ target }) => target > 0)
      .map(async ({ length, target }) => [length, await buildExactLengthPrompt(length, params, target)] as const)
  )

  return entries.reduce<Record<number, string>>((acc, [length, prompt]) => {
    acc[length] = prompt
    return acc
  }, {})
}

export async function buildExactLengthBundlePrompt(
  bundle: ExactLengthBundle,
  params: BuildPromptParams
) {
  const template = await loadBundleTemplate()
  const basePrompt = params.basePrompt.trim()
  const promptSection = basePrompt ? `附加提示词：\n${basePrompt}` : ''
  const title = params.title?.trim()
  const titleSection = title ? `视频标题：${sanitizePromptText(title)}` : ''
  const commentSamples = normalizeCommentSamples(params.commentSamples)
  const sampleSection = commentSamples.length
    ? `评论样本（仅供模仿语气、句式和节奏，不要照抄）：\n${commentSamples.map((sample) => `- ${sample}`).join('\n')}`
    : ''
  const contextSection = [titleSection, sampleSection, promptSection].filter(Boolean).join('\n')
  const targetLines = bundle.targetLines
  return template
    .replaceAll('{{PROMPT_SECTION}}', contextSection)
    .replaceAll('{{BUNDLE_LABEL}}', bundle.label)
    .replaceAll('{{BUNDLE_RANGE}}', bundle.range)
    .replaceAll('{{BUNDLE_TARGETS}}', targetLines)
    .replaceAll('{{BUNDLE_OUTPUT_FORMAT}}', bundle.lengths.map((item) => `【${item.length}字】`).join('\n'))
    .replaceAll('{{EMOJI_LIST}}', ALLOWED_EMOJI_TEXT)
    .replaceAll('{{STYLE_TARGET}}', String(bundle.total))
}

export async function buildExactLengthBundlePrompts(
  params: BuildPromptParams,
  bundles: ExactLengthBundle[]
) {
  const entries = await Promise.all(
    bundles
      .filter((bundle) => bundle.total > 0)
      .map(async (bundle) => ({
        bundle,
        prompt: await buildExactLengthBundlePrompt(bundle, params)
      }))
  )

  return entries
}

export function parseExactLengthBundleOutput(
  rawText: string,
  targets: ExactLengthTarget[]
) {
  const targetLengths = new Set(targets.map((item) => item.length))
  const sections = new Map<number, string[]>()

  for (const target of targets) {
    sections.set(target.length, [])
  }

  const lines = rawText.split(/\r?\n/)
  let currentLength: number | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const headingMatch = line.match(/^[【\[\(]?\s*(\d+)\s*字(?:\s*[】\]\)])?\s*[:：-]?\s*(.*)$/)
    if (headingMatch) {
      const length = Number(headingMatch[1])
      if (targetLengths.has(length)) {
        currentLength = length
        const rest = headingMatch[2]?.trim()
        if (rest) {
          sections.get(length)?.push(rest)
        }
        continue
      }
    }

    if (currentLength != null) {
      sections.get(currentLength)?.push(line)
    }
  }

  return Object.fromEntries(sections.entries()) as Record<number, string[]>
}

export function stripExactLengthBundleHeadings(rawText: string) {
  if (!rawText) return rawText

  const lines = rawText.split(/\r?\n/)
  const filtered = lines.filter((line) => !/^[【\[\(]\s*\d+\s*字\s*[】\]\)]$/.test(line.trim()))
  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function buildStylePrompts(
  params: BuildPromptParams,
  targets: Record<CommentStyle, number>
) {
  const entries = await Promise.all(
    STYLE_ORDER
      .filter((style) => targets[style] > 0)
      .map(async (style) => [style, await buildStylePrompt(style, params, targets[style])] as const)
  )

  return entries.reduce<Record<CommentStyle, string>>((acc, [style, prompt]) => {
    acc[style] = prompt
    return acc
  }, { long: '', medium: '', short: '' })
}

export async function buildLengthBucketPrompt(
  bucket: LengthBucketConfig,
  params: BuildPromptParams,
  target: number
) {
  return buildStylePrompt(bucket.style, {
    ...params,
    lengthBucket: bucket.label,
    lengthRange: bucket.range,
    lengthSubranges: bucket.subranges
  }, target)
}

export async function buildLengthBucketPrompts(
  params: BuildPromptParams,
  targets: Record<LengthBucketKey, number>
) {
  const entries = await Promise.all(
    LENGTH_BUCKET_ORDER
      .filter((key) => targets[key] > 0)
      .map(async (key) => {
        const bucket = LENGTH_BUCKETS[key]
        return [key, await buildLengthBucketPrompt(bucket, params, targets[key])] as const
      })
  )

  return entries.reduce<Record<LengthBucketKey, string>>((acc, [key, prompt]) => {
    acc[key] = prompt
    return acc
  }, {
    short_1: '',
    short_2: '',
    medium_1: '',
    medium_2: '',
    long_1: '',
    long_2: ''
  })
}
