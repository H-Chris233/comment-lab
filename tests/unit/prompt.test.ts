import { describe, expect, it } from 'vitest'
import { buildStylePrompts, splitStyleTargets } from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化，多用反问句'
    }, splitStyleTargets(100))

    expect(result.long).toContain('真实路人评论')
    expect(result.medium).toContain('真实路人评论')
    expect(result.short).toContain('真实路人评论')
    expect(result.long).toContain('25~35字')
    expect(result.medium).toContain('10~25字')
    expect(result.short).toContain('3~10字')
    expect(result.long).toContain('达到 20 条立即停止')
    expect(result.medium).toContain('达到 40 条立即停止')
    expect(result.short).toContain('达到 40 条立即停止')
    expect(result.long).toContain('仅可少量加入以下 emoji：😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.medium).toContain('仅可少量加入以下 emoji：😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.short).toContain('仅可少量加入以下 emoji：😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.long).toContain('附加提示词：')
    expect(result.long).toContain('请偏口语化')
    expect(result.long).toContain('多用反问句')
  })

  it('允许不传附加提示词', async () => {
    const result = await buildStylePrompts({
      basePrompt: ''
    }, splitStyleTargets(100))

    expect(result.long).not.toContain('附加提示词：')
  })

  it('link 模式可注入视频标题到 prompt 上下文', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, splitStyleTargets(100))

    expect(result.long).toContain('视频标题：这个夏天最治愈的一段')
    expect(result.medium).toContain('视频标题：这个夏天最治愈的一段')
    expect(result.short).toContain('视频标题：这个夏天最治愈的一段')
  })

  it('按 40/40/20 拆分目标条数', () => {
    expect(splitStyleTargets(100)).toEqual({ short: 40, medium: 40, long: 20 })
    expect(splitStyleTargets(200)).toEqual({ short: 80, medium: 80, long: 40 })
    expect(splitStyleTargets(300)).toEqual({ short: 120, medium: 120, long: 60 })
  })
})
