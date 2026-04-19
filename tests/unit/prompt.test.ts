import { describe, expect, it } from 'vitest'
import { buildStylePrompts } from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化，多用反问句'
    })

    expect(result.long).toContain('真实评论区模拟专家')
    expect(result.medium).toContain('真实评论区模拟专家')
    expect(result.short).toContain('真实评论区模拟专家')
    expect(result.long).toContain('长评论 60 条')
    expect(result.medium).toContain('中评论 60 条')
    expect(result.short).toContain('短评论 60 条')
    expect(result.long).toContain('附加提示词：')
    expect(result.long).toContain('请偏口语化')
    expect(result.long).toContain('多用反问句')
    expect(result.medium).toContain('输出格式要求：纯文本，每行一条评论。')
  })

  it('允许不传附加提示词', async () => {
    const result = await buildStylePrompts({
      basePrompt: ''
    })

    expect(result.long).not.toContain('附加提示词：')
  })
})
