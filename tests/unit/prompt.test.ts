import { describe, expect, it } from 'vitest'
import { buildStylePrompts } from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化',
      extraPrompt: '多用反问句'
    })

    expect(result.long).toContain('当前任务只生成长评论')
    expect(result.medium).toContain('当前任务只生成中评论')
    expect(result.short).toContain('当前任务只生成短评论')
    expect(result.long).toContain('长评论 60 条')
    expect(result.medium).toContain('中评论 60 条')
    expect(result.short).toContain('短评论 60 条')
    expect(result.long).toContain('请偏口语化')
    expect(result.long).toContain('多用反问句')
    expect(result.medium).toContain('输出格式要求：纯文本，每行一条评论。')
  })
})
