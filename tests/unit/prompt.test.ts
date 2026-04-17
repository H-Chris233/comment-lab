import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../../server/services/prompt'

describe('buildPrompt', () => {
  it('应包含固定约束和数量要求', () => {
    const result = buildPrompt({
      basePrompt: '请偏口语化',
      extraPrompt: '多用反问句',
      count: 100,
      outputFormat: 'text'
    })

    expect(result).toContain('只输出评论正文')
    expect(result).toContain('目标数量：100 条')
    expect(result).toContain('若中途生成不足指定数量')
    expect(result).toContain('默认提示词模板')
    expect(result).toContain('附加要求')
  })
})
