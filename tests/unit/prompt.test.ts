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

    expect(result.long).toContain('25~35字')
    expect(result.medium).toContain('10~25字')
    expect(result.short).toContain('3~10字')

    expect(result.long).toContain('输出 20 条')
    expect(result.medium).toContain('输出 40 条')
    expect(result.short).toContain('输出 40 条')

    expect(result.long).toContain('被产品触动想表达两句，但仍然是评论区的随手口吻')
    expect(result.medium).toContain('被产品吸引后愿意多打一两行字聊聊自己的感受')
    expect(result.short).toContain('被某个点吸引或触动，随手留下一句即时反应')

    expect(result.long).toContain('字数双重限制')
    expect(result.long).toContain('不超过30字')
    expect(result.medium).toContain('字数要求：每条评论控制在10–20字之间')
    expect(result.short).toContain('字数要求：每条评论字数随机分布')

    expect(result.long).toContain('当前长度桶：长评论组')
    expect(result.medium).toContain('当前长度桶：中评论组')
    expect(result.short).toContain('当前长度桶：短评论组')

    expect(result.long).toContain('本轮以 25~35字 的评论为主')
    expect(result.medium).toContain('本轮以 10~25字 的评论为主')
    expect(result.short).toContain('本轮以 3~10字 的评论为主')

    expect(result.long).toContain('20–25%')
    expect(result.medium).toContain('20–25%')
    expect(result.short).toContain('20–25%')
    expect(result.long).toContain('1/3 放开头')
    expect(result.medium).toContain('1/3 放开头')
    expect(result.short).toContain('1/3 放开头')

    expect(result.long).toContain('Emoji 不计入字数')
    expect(result.medium).toContain('Emoji 不计入字数')
    expect(result.short).toContain('Emoji 不计入字数')

    expect(result.long).not.toContain('{{EMOJI_LIST}}')
    expect(result.medium).not.toContain('{{EMOJI_LIST}}')
    expect(result.short).not.toContain('{{EMOJI_LIST}}')

    expect(result.long).toContain('Emoji 和句尾标点不可同时出现')
    expect(result.medium).toContain('Emoji 和句尾标点不可同时出现')
    expect(result.short).toContain('Emoji 和句尾标点不可同时出现')

    expect(result.long).toContain('不要复述视频内容')
    expect(result.medium).toContain('不要复述视频内容')
    expect(result.short).toContain('不要复述视频内容')

    expect(result.long).toContain('字数双重限制')
    expect(result.medium).toContain('字数要求：每条评论控制在10–20字之间')

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

  it('link 模式可注入评论样本到 prompt 上下文', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段',
      commentSamples: [
        '这个镜头真的好舒服',
        '主包这段状态太松弛了',
        '这个镜头真的好舒服'
      ]
    }, splitStyleTargets(100))

    expect(result.long).toContain('评论样本（仅供模仿语气、句式和节奏，不要照抄）')
    expect(result.long).toContain('- 这个镜头真的好舒服')
    expect(result.long).toContain('- 主包这段状态太松弛了')
    expect(result.long).not.toContain('这个镜头真的好舒服\n- 这个镜头真的好舒服')
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

    expect(result.short).toContain('严格禁止使用以下词汇或表达：博主、种草、笑死我了')
    expect(result.medium).toContain('严格禁止使用以下词汇或表达：博主、种草、笑死我了')
    expect(result.long).toContain('严格禁止使用以下词汇或表达：博主、种草、笑死我了')
  })
})
