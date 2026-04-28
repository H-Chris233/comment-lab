export const DEFAULT_PROMPT = ''

export const DEFAULT_MODEL = 'qwen3.5-omni-plus'

export const MODEL_OPTIONS = [
  { value: 'qwen3.5-omni-plus', label: 'qwen3.5-omni-plus' },
  { value: 'qwen3.5-plus', label: 'qwen3.5-plus' },
  { value: 'qwen3.6-plus', label: 'qwen3.6-plus' }
] as const

export type ModelOption = (typeof MODEL_OPTIONS)[number]['value']

export function supportsThinkingMode(model?: string) {
  if (!model) return false
  return model.startsWith('qwen3.5-plus') || model.startsWith('qwen3.6-plus')
}

export interface BuildPromptParams {
  basePrompt: string
  title?: string
  lengthBucket?: string
  lengthRange?: string
  lengthSubranges?: string
}
