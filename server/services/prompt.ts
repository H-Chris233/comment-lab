import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildPromptParams } from '../../types/prompt'

export type CommentStyle = 'long' | 'medium' | 'short'

export const STYLE_ORDER: CommentStyle[] = ['short', 'medium', 'long']

export const STYLE_RATIOS: Record<CommentStyle, number> = {
  short: 0.4,
  medium: 0.4,
  long: 0.2
}

const TEMPLATE_CACHE = new Map<CommentStyle, string>()

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

function renderTemplate(template: string, params: BuildPromptParams, target: number) {
  const basePrompt = params.basePrompt.trim()
  const promptSection = basePrompt ? `附加提示词：\n${basePrompt}` : ''

  return template
    .replaceAll('{{PROMPT_SECTION}}', promptSection)
    .replaceAll('{{STYLE_TARGET}}', String(target))
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

export function splitStyleTargets(total: number) {
  if (total <= 0) {
    return { long: 0, medium: 0, short: 0 }
  }

  return splitByRatio(total)
}

export async function buildStylePrompt(style: CommentStyle, params: BuildPromptParams, target: number) {
  const template = await loadTemplate(style)
  return renderTemplate(template, params, target)
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
