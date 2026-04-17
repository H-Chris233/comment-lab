export const DEFAULT_PROMPT = `[此处留空，由你自行填写]`

export const DEFAULT_EXTRA_PROMPT = ''

export const DEFAULT_MODEL = 'qwen3.5-omni-plus'

export interface BuildPromptParams {
  basePrompt: string
  extraPrompt?: string
  count: number
  outputFormat?: 'text' | 'json'
}
