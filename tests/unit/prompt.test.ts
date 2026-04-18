import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../../server/services/prompt'

describe('buildPrompt', () => {
  it('应包含固定约束和数量要求', () => {
    const result = buildPrompt({
      basePrompt: '请偏口语化',
      extraPrompt: '多用反问句',
      count: 100
    })

    expect(result).toContain('只输出评论正文')
    expect(result).toContain('目标数量：100 条')
    expect(result).toContain('若中途生成不足指定数量')
    expect(result).toContain('默认提示词模板')
    expect(result).toContain('附加要求')
    expect(result).toContain('长度硬性要求（必须遵守）')
    expect(result).toContain('输出顺序必须按「长→中→短」循环重复')
  })
})
