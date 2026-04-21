export const DEFAULT_PROMPT = ''

export const DEFAULT_MODEL = 'qwen3.5-omni-plus'

export interface BuildPromptParams {
  basePrompt: string
  title?: string
  commentSamples?: string[]
  lengthBucket?: string
  lengthRange?: string
  lengthSubranges?: string
}
