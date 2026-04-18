import type { BuildPromptParams } from '../../types/prompt'

type LengthPlan = {
  longCount: number
  mediumCount: number
  shortCount: number
}

const ROUND_TARGET = 60

function buildLengthPlan(total: number): LengthPlan {
  // 目标配比：长:中:短 = 25% : 35% : 40%
  const longRaw = total * 0.25
  const mediumRaw = total * 0.35
  const shortRaw = total - longRaw - mediumRaw

  let longCount = Math.floor(longRaw)
  let mediumCount = Math.floor(mediumRaw)
  let shortCount = Math.floor(shortRaw)

  let diff = total - (longCount + mediumCount + shortCount)
  const remainders = [
    { key: 'long', value: longRaw - longCount },
    { key: 'medium', value: mediumRaw - mediumCount },
    { key: 'short', value: shortRaw - shortCount }
  ].sort((a, b) => b.value - a.value)

  for (let i = 0; i < remainders.length && diff > 0; i += 1) {
    if (remainders[i].key === 'long') longCount += 1
    if (remainders[i].key === 'medium') mediumCount += 1
    if (remainders[i].key === 'short') shortCount += 1
    diff -= 1
  }

  return { longCount, mediumCount, shortCount }
}

const SYSTEM_WRAPPER = [
  '你是一个中文短视频评论生成助手。',
  '只输出评论正文，每行一条，不要编号，不要解释，不要加标题。',
  '严格执行评论长度分配规则，保持口语自然。',
  `单轮任务固定为 ${ROUND_TARGET} 条，若中途不足请继续补足，达到 ${ROUND_TARGET} 条立即停止。`
].join(' ')

export function buildPrompt(params: BuildPromptParams) {
  const lengthPlan = buildLengthPlan(ROUND_TARGET)

  return [
    SYSTEM_WRAPPER,
    [
      '长度硬性要求（必须遵守）：',
      `- 长评论 ${lengthPlan.longCount} 条（每条约 21~35 字）`,
      `- 中评论 ${lengthPlan.mediumCount} 条（每条约 13~20 字）`,
      `- 短评论 ${lengthPlan.shortCount} 条（每条约 6~12 字）`,
      `- 输出顺序必须按「长→中→短」循环重复，直到达到 ${ROUND_TARGET} 条`,
      '- 若某类数量已满，继续按剩余未满类型输出，不得超配'
    ].join('\n'),
    `默认提示词模板：\n${params.basePrompt.trim()}`,
    params.extraPrompt?.trim() ? `附加要求：\n${params.extraPrompt.trim()}` : '',
    '输出格式要求：纯文本，每行一条评论。'
  ].filter(Boolean).join('\n\n')
}
