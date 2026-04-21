import { describe, expect, it } from 'vitest'
import {
  buildLengthBucketPrompts,
  buildStylePrompts,
  splitLengthBucketTargets,
  splitStyleTargets
} from '../../server/services/prompt'

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

  it('按 6 桶均匀拆分目标条数', () => {
    expect(splitLengthBucketTargets(6)).toEqual({
      short_1: 1,
      short_2: 1,
      medium_1: 1,
      medium_2: 1,
      long_1: 1,
      long_2: 1
    })

    expect(splitLengthBucketTargets(100)).toEqual({
      short_1: 17,
      short_2: 17,
      medium_1: 17,
      medium_2: 17,
      long_1: 16,
      long_2: 16
    })
  })

  it('六桶 prompt 会注入桶范围', async () => {
    const result = await buildLengthBucketPrompts({
      basePrompt: '请偏口语化',
      title: '这个夏天最治愈的一段'
    }, splitLengthBucketTargets(6))

    expect(result.short_1).toContain('当前长度桶：短评论桶 A')
    expect(result.short_1).toContain('3~5字')
    expect(result.long_2).toContain('当前长度桶：长评论桶 B')
    expect(result.long_2).toContain('28~35字')
  })
})
