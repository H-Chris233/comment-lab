import { describe, expect, it } from 'vitest'
import {
  buildExactLengthBundlePrompt,
  buildStylePrompts,
  splitExactLengthTargetBundles,
  splitStyleTargets
} from '../../server/services/prompt'

describe('buildStylePrompts', () => {
  it('应从三份独立 txt 模板生成三种风格 prompt', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化，多用反问句'
    }, splitStyleTargets(100))

    expect(result.long).toContain('根据以下视频内容生成 20 条评论。视频内容：')
    expect(result.medium).toContain('根据以下视频内容生成 40 条评论。视频内容：')
    expect(result.short).toContain('根据以下视频内容，生成 40 条短视频评论。视频内容：')

    expect(result.long).toContain('20~30字')
    expect(result.medium).toContain('10~20字')
    expect(result.short).toContain('3~10字')

    expect(result.long).toContain('⚠️ 核心命令：输出恰好 20 条评论')
    expect(result.medium).toContain('⚠️ 核心任务：生成恰好 40 条评论')
    expect(result.short).toContain('⚠️ 核心任务：生成恰好 40 条评论')

    expect(result.long).toContain('口吻随意、口语化')
    expect(result.medium).toContain('像在和朋友闲聊一样的口吻')
    expect(result.short).toContain('用聊天框里随手敲出去的口吻')

    expect(result.long).toContain('最短的那条与最长的那条字数差距不少于 6 个字')
    expect(result.medium).toContain('如果最长的比最短的多不足 6 个字')
    expect(result.short).toContain('每条评论必须严格 ≤10 个字')

    expect(result.long).toContain('当前长度桶：长评论组')
    expect(result.medium).toContain('当前长度桶：中评论组')
    expect(result.short).toContain('当前长度桶：短评论组')

    expect(result.long).toContain('本轮以 20~30字 的评论为主')
    expect(result.medium).toContain('本轮以 10~20字 的评论为主')
    expect(result.short).toContain('本轮以 3~10字 的评论为主')

    expect(result.long).toContain('字数要故意打散')
    expect(result.medium).toContain('字数要故意打散')
    expect(result.short).toContain('字数要故意打散')

    expect(result.long).toContain('40%–45%')
    expect(result.medium).toContain('30–35%')
    expect(result.short).toContain('约 1/4 到 1/3')
    expect(result.long).toContain('1/3 在开头')
    expect(result.medium).toContain('开头、中间或结尾')
    expect(result.short).toContain('位置随机出现在开头、中间或结尾')

    expect(result.long).toContain('Emoji 不与句尾标点共生，不计入字数')
    expect(result.medium).toContain('Emoji 不计入字数，不与句尾标点同存')
    expect(result.short).toContain('不与句尾标点同存')

    expect(result.long).not.toContain('{{EMOJI_LIST}}')
    expect(result.medium).not.toContain('{{EMOJI_LIST}}')
    expect(result.short).not.toContain('{{EMOJI_LIST}}')

    expect(result.long).toContain('禁止复述视频画面、台词、剧情')
    expect(result.medium).toContain('禁止复述视频画面、动作、台词')
    expect(result.short).toContain('禁止复述视频内容')

    expect(result.long).toContain('至少要有 2 条在 20–22 字区间')
    expect(result.medium).toContain('每条 10–20 字')

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
    expect(result.medium).toContain('禁用词：博主、种草、笑死我了')
    expect(result.long).toContain('禁用词（严格禁止出现）')
  })

  it('bundle prompt 也会同步提高 emoji 使用频率', async () => {
    const bundles = splitExactLengthTargetBundles([
      { length: 3, target: 1 },
      { length: 4, target: 1 },
      { length: 5, target: 1 },
      { length: 6, target: 1 },
      { length: 7, target: 1 }
    ])

    const result = await buildExactLengthBundlePrompt(bundles[0], {
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    })

    expect(result).toContain('总量约25%')
    expect(result).toContain('75% 不用 Emoji、25% 用 Emoji')
    expect(result).toContain('25% 的 Emoji 尽量均匀分布在开头、中间、结尾')
  })
})
