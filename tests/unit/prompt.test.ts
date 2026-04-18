import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../../server/services/prompt'

describe('buildPrompt', () => {
  it('应包含固定约束和单轮 60 条要求', () => {
    const result = buildPrompt({
      basePrompt: '请偏口语化',
      extraPrompt: '多用反问句'
    })

    expect(result).toContain('只输出评论正文')
    expect(result).toContain('单轮任务固定为 60 条')
    expect(result).toContain('默认提示词模板')
    expect(result).toContain('附加要求')
    expect(result).toContain('长度硬性要求（必须遵守）')
    expect(result).toContain('输出顺序必须按「长→中→短」循环重复')
  })
})
