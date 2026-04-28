import { describe, expect, it } from 'vitest'
import {
  buildStylePrompts,
  splitStyleTargets
} from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化，多用反问句'
    }, splitStyleTargets(100))

    expect(result.long).toContain('根据以下视频内容生成评论：')
    expect(result.medium).toContain('根据以下视频内容生成评论：')
    expect(result.short).toContain('根据以下视频内容生成评论：')

    expect(result.long).toContain('20~30字')
    expect(result.medium).toContain('10~20字')
    expect(result.short).toContain('3~10字')

    expect(result.long).toContain('输出 20 条评论')
    expect(result.medium).toContain('请按以下规则输出 40 条中评论')
    expect(result.short).toContain('为视频生成 40 条短评论')

    expect(result.long).toContain('口吻随意、口语化')
    expect(result.medium).toContain('语气像随口闲聊')
    expect(result.short).toContain('像聊天框里随手敲出去的话')

    expect(result.long).toContain('字数随机分布在 20–30 字之间')
    expect(result.medium).toContain('每条10–20字')
    expect(result.short).toContain('极短、即时的口吻')

    expect(result.long).toContain('当前长度桶：长评论组')
    expect(result.medium).toContain('当前长度桶：中评论组')
    expect(result.short).toContain('当前长度桶：短评论组')

    expect(result.long).toContain('本轮以 20~30字 的评论为主')
    expect(result.medium).toContain('本轮以 10~20字 的评论为主')
    expect(result.short).toContain('本轮以 3~10字 的评论为主')

    expect(result.long).toContain('字数要故意打散')
    expect(result.medium).toContain('字数要故意打散')
    expect(result.short).toContain('字数要故意打散')

    expect(result.long).toContain('30%–35%')
    expect(result.medium).toContain('20–25%')
    expect(result.short).toContain('20–25%')
    expect(result.long).toContain('1/3 放开头')
    expect(result.medium).toContain('1/3放开头')
    expect(result.short).toContain('1/3在开头')

    expect(result.long).toContain('Emoji 不与句尾标点同时出现')
    expect(result.medium).toContain('Emoji不计入字数')
    expect(result.short).toContain('Emoji 不与句尾标点共存')

    expect(result.long).not.toContain('{{EMOJI_LIST}}')
    expect(result.medium).not.toContain('{{EMOJI_LIST}}')
    expect(result.short).not.toContain('{{EMOJI_LIST}}')

    expect(result.long).toContain('Emoji 不与句尾标点同时出现')
    expect(result.medium).toContain('Emoji不计入字数')
    expect(result.short).toContain('Emoji 不与句尾标点共存')

    expect(result.long).toContain('禁止复述视频画面、台词、剧情')
    expect(result.medium).toContain('禁止复述视频画面、动作、台词')
    expect(result.short).toContain('禁止复述视频内容')

    expect(result.long).toContain('字数随机分布在 20–30 字之间')
    expect(result.medium).toContain('每条10–20字')

    expect(result.long).toContain('附加提示词：')
    expect(result.long).toContain('请偏口语化')
    expect(result.long).toContain('多用反问句')

    expect(result.long).not.toContain('精确长度')
    expect(result.medium).not.toContain('精确长度')
    expect(result.short).not.toContain('精确长度')
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

  it('prompt 上下文不再包含评论样本', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, splitStyleTargets(100))

    expect(result.long).not.toContain('评论样本')
    expect(result.medium).not.toContain('评论样本')
    expect(result.short).not.toContain('评论样本')
  })

  it('按 40/40/20 拆分风格目标条数', () => {
    expect(splitStyleTargets(100)).toEqual({ short: 40, medium: 40, long: 20 })
    expect(splitStyleTargets(200)).toEqual({ short: 80, medium: 80, long: 40 })
    expect(splitStyleTargets(300)).toEqual({ short: 120, medium: 120, long: 60 })
  })

  it('prompt 会明确禁止当前不想要的句式风格', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化'
    }, splitStyleTargets(100))

    expect(result.short).toContain('博主、种草、笑死我了')
    expect(result.medium).toContain('禁用：“博主、种草、笑死我了')
    expect(result.long).toContain('禁用词（不得出现）')
  })
})
