import type { BuildPromptParams } from '../../types/prompt'

const SYSTEM_WRAPPER = [
  '你是一个中文短视频评论生成助手。',
  '只输出评论正文，每行一条，不要编号，不要解释，不要加标题。',
  '请混合长短句，保持口语自然。',
  '若中途生成不足指定数量，请继续补足，直到满足数量要求。'
].join(' ')

export function buildPrompt(params: BuildPromptParams) {
  const formatHint = params.outputFormat === 'json'
    ? '输出格式要求：仅输出 JSON 数组字符串，每个元素是一条评论。'
    : '输出格式要求：纯文本，每行一条评论。'

  return [
    SYSTEM_WRAPPER,
    `目标数量：${params.count} 条。`,
    `默认提示词模板：\n${params.basePrompt.trim()}`,
    params.extraPrompt?.trim() ? `附加要求：\n${params.extraPrompt.trim()}` : '',
    formatHint
  ].filter(Boolean).join('\n\n')
}
