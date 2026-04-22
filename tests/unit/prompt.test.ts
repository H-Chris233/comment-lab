import { describe, expect, it } from 'vitest'
import {
  buildExactLengthPrompts,
  buildStylePrompts,
  splitExactLengthTargets,
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
    expect(result.long).toContain('整体字数按系统分配的精确长度执行')
    expect(result.medium).toContain('整体字数按系统分配的精确长度执行')
    expect(result.short).toContain('整体字数按系统分配的精确长度执行')
    expect(result.long).toContain('限定Emoji为 😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.medium).toContain('限定Emoji为 😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.short).toContain('限定Emoji为 😎🌹😡👋😅😂😲👍😣🤣🥀')
    expect(result.long).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.medium).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.short).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.long).toContain('尾巴标点可不带，也可用。！？')
    expect(result.medium).toContain('尾巴标点可不带，也可用。！？')
    expect(result.short).toContain('尾巴标点可不带，也可用。！？')
    expect(result.long).toContain('每个字数都尽量覆盖')
    expect(result.medium).toContain('每个字数都尽量覆盖')
    expect(result.short).toContain('每个字数都尽量覆盖')
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

  it('按 40/40/20 拆分目标条数', () => {
    expect(splitStyleTargets(100)).toEqual({ short: 40, medium: 40, long: 20 })
    expect(splitStyleTargets(200)).toEqual({ short: 80, medium: 80, long: 40 })
    expect(splitStyleTargets(300)).toEqual({ short: 120, medium: 120, long: 60 })
  })

  it('按 3~27 字精确拆分目标条数', () => {
    expect(splitExactLengthTargets(4, 3, 6)).toEqual([
      { length: 3, target: 1 },
      { length: 4, target: 1 },
      { length: 5, target: 1 },
      { length: 6, target: 1 }
    ])

    expect(splitExactLengthTargets(100, 3, 27)).toHaveLength(25)
    expect(splitExactLengthTargets(100, 3, 27).every((entry) => entry.target === 4)).toBe(true)
  })

  it('精确字数 prompt 会注入精确长度', async () => {
    const result = await buildExactLengthPrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, [
      { length: 3, target: 1 },
      { length: 18, target: 1 },
      { length: 27, target: 1 }
    ])

    expect(result[3]).toContain('当前长度桶：精确长度 3 字')
    expect(result[3]).toContain('本轮只生成 3字 的评论')
    expect(result[18]).toContain('当前长度桶：精确长度 18 字')
    expect(result[27]).toContain('当前长度桶：精确长度 27 字')
  })

  it('prompt 会明确禁止当前不想要的句式风格', async () => {
    const result = await buildStylePrompts({
      basePrompt: '请偏口语化'
    }, splitStyleTargets(100))

    expect(result.short).toContain('严格禁止出现以下词汇或表达：博主、种草、笑死我了')
    expect(result.medium).toContain('严格禁止出现以下词汇或表达：博主、种草、笑死我了')
    expect(result.long).toContain('严格禁止出现以下词汇或表达：博主、种草、笑死我了')
  })
})
