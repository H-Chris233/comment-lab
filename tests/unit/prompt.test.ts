import { describe, expect, it } from 'vitest'
import {
  buildExactLengthBundlePrompts,
  buildExactLengthPrompts,
  buildStylePrompts,
  parseExactLengthBundleOutput,
  splitExactLengthTargetBundles,
  splitExactLengthTargets,
  stripExactLengthBundleHeadings,
  splitStyleTargets
} from '../../server/services/prompt'
import { ALLOWED_EMOJI_TEXT } from '../../server/services/emoji'

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
    expect(result.long).toContain('多样化表达，减少重复的开头和结尾')
    expect(result.medium).toContain('多样化表达，减少重复的开头和结尾')
    expect(result.short).toContain('多样化表达，减少重复的开头和结尾')
    expect(result.long).toContain('整体字数按系统分配的精确长度执行')
    expect(result.medium).toContain('整体字数按系统分配的精确长度执行')
    expect(result.short).toContain('整体字数按系统分配的精确长度执行')
    expect(result.long).toContain(`限定Emoji为 ${ALLOWED_EMOJI_TEXT}`)
    expect(result.medium).toContain(`限定Emoji为 ${ALLOWED_EMOJI_TEXT}`)
    expect(result.short).toContain(`限定Emoji为 ${ALLOWED_EMOJI_TEXT}`)
    expect(result.long).toContain('Emoji 不计入字数')
    expect(result.medium).toContain('Emoji 不计入字数')
    expect(result.short).toContain('Emoji 不计入字数')
    expect(result.long).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.medium).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.short).toContain('总量约10%，分散在句首、中间、句尾都可以')
    expect(result.long).toContain('不要复述视频内容')
    expect(result.medium).toContain('不要复述视频内容')
    expect(result.short).toContain('不要复述视频内容')
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

  it('按 6~33 字精确拆分目标条数', () => {
    expect(splitExactLengthTargets(4, 6, 7)).toEqual([
      { length: 6, target: 2 },
      { length: 7, target: 2 }
    ])

    expect(splitExactLengthTargets(100, 6, 33)).toHaveLength(28)
    expect(splitExactLengthTargets(100, 6, 33).reduce((sum, entry) => sum + entry.target, 0)).toBe(100)
    expect(splitExactLengthTargets(100, 6, 33).every((entry) => entry.target >= 3)).toBe(true)
  })

  it('按 6 个精确字数拆成 6 个 bundle', () => {
    const bundles = splitExactLengthTargetBundles(splitExactLengthTargets(100, 6, 33), 5)

    expect(bundles).toHaveLength(6)
    expect(bundles.map((bundle) => bundle.lengths.map((item) => item.length))).toEqual([
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
      [16, 17, 18, 19, 20],
      [21, 22, 23, 24, 25],
      [26, 27, 28, 29, 30],
      [31, 32, 33]
    ])
    expect(bundles.map((bundle) => bundle.total)).toEqual([20, 20, 20, 16, 15, 9])
  })

  it('bundle prompt 会把多个精确字数合并到同一次调用中', async () => {
    const bundles = splitExactLengthTargetBundles(splitExactLengthTargets(100, 6, 33), 5)
    const result = await buildExactLengthBundlePrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, bundles)

    expect(result).toHaveLength(6)
    expect(result[0].prompt).toContain('多样化表达，减少重复的开头和结尾')
    expect(result[0].prompt).toContain('当前长度组：6~10字')
    expect(result[0].prompt).toContain('本组目标：6字 4条、7字 4条、8字 4条、9字 4条、10字 4条')
    expect(result[0].prompt).toContain('【6字】')
    expect(result[0].prompt).toContain('【10字】')
    expect(result[0].prompt).toContain('不要复述视频内容')
  })

  it('能解析 bundle 输出里的各个精确字数分段', () => {
    const parsed = parseExactLengthBundleOutput(`【6字】
abc
abd
【7字】
abcd
abce
`, [
      { length: 6, target: 2 },
      { length: 7, target: 2 }
    ])

    expect(parsed[6]).toEqual(['abc', 'abd'])
    expect(parsed[7]).toEqual(['abcd', 'abce'])
  })

  it('会清理 bundle 段头但保留正文', () => {
    const cleaned = stripExactLengthBundleHeadings(`【6字】
aaaaa
【7字】
bbbbbb
`)

    expect(cleaned).toBe('aaaaa\nbbbbbb')
  })

  it('会去掉同一行里粘连的 bundle 段头', () => {
    const cleaned = stripExactLengthBundleHeadings(`【27字】这行正文还在
【28字】：这行也要保留
【29字】- 这行同样保留
`)

    expect(cleaned).toBe('这行正文还在\n这行也要保留\n这行同样保留')
  })

  it('精确字数 prompt 会注入精确长度', async () => {
    const result = await buildExactLengthPrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, [
      { length: 6, target: 1 },
      { length: 18, target: 1 },
      { length: 33, target: 1 }
    ])

    expect(result[6]).toContain('当前长度桶：精确长度 6 字')
    expect(result[6]).toContain('本轮只生成 6字 的评论')
    expect(result[18]).toContain('当前长度桶：精确长度 18 字')
    expect(result[33]).toContain('当前长度桶：精确长度 33 字')
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
