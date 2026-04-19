import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildPromptParams } from '../../types/prompt'

export type CommentStyle = 'long' | 'medium' | 'short'

export const STYLE_TARGET_PER_CALL = 60

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

function renderTemplate(template: string, params: BuildPromptParams) {
  const basePrompt = params.basePrompt.trim()
  const extraPrompt = params.extraPrompt?.trim() || ''

  return template
    .replaceAll('{{BASE_PROMPT}}', basePrompt)
    .replaceAll('{{EXTRA_PROMPT}}', extraPrompt)
    .replaceAll('{{EXTRA_PROMPT_SECTION}}', extraPrompt ? `附加要求：\n${extraPrompt}` : '')
    .replaceAll('{{STYLE_TARGET}}', String(STYLE_TARGET_PER_CALL))
}

export async function buildStylePrompt(style: CommentStyle, params: BuildPromptParams) {
  const template = await loadTemplate(style)
  return renderTemplate(template, params)
}

export async function buildStylePrompts(params: BuildPromptParams) {
  const [long, medium, short] = await Promise.all([
    buildStylePrompt('long', params),
    buildStylePrompt('medium', params),
    buildStylePrompt('short', params)
  ])

  return {
    long,
    medium,
    short
  } satisfies Record<CommentStyle, string>
}
