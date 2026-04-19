import { describe, expect, it } from 'vitest'
import { buildStylePrompts } from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化，多用反问句'
    })

    expect(result.long).toContain('真实路人评论')
    expect(result.medium).toContain('真实路人评论')
    expect(result.short).toContain('真实路人评论')
    expect(result.long).toContain('25~35字')
    expect(result.medium).toContain('10~25字')
    expect(result.short).toContain('3~10字')
    expect(result.long).toContain('达到 60 条立即停止')
    expect(result.medium).toContain('达到 60 条立即停止')
    expect(result.short).toContain('达到 60 条立即停止')
    expect(result.long).toContain('附加提示词：')
    expect(result.long).toContain('请偏口语化')
    expect(result.long).toContain('多用反问句')
  })

  it('允许不传附加提示词', async () => {
    const result = await buildStylePrompts({
      basePrompt: ''
    })

    expect(result.long).not.toContain('附加提示词：')
  })
})
