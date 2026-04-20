import { describe, expect, it } from 'vitest'
import { normalizeComments } from '../../server/services/normalize'

describe('normalizeComments', () => {
  it('应清洗无效行并统计', () => {
    const raw = ['1. 这个真有点上头', '', '评论如下', '这个真有点上头', '好', '   太长'.repeat(30)].join('\n')
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['这个真有点上头'])
    expect(result.beforeCount).toBeGreaterThan(0)
    expect(result.afterCount).toBe(1)
    expect(result.removedEmpty).toBeGreaterThanOrEqual(1)
    expect(result.removedDuplicate).toBeGreaterThanOrEqual(1)
    expect(result.removedInvalid).toBeGreaterThanOrEqual(1)
  })

  it('文本模式可以清洗重复与废话行', () => {
    const result = normalizeComments('  1. 真的好看  \n评论如下\n真的好看\n哈哈', { dedupe: true, cleanEmpty: true })
    expect(result.comments).toEqual(['真的好看', '哈哈'])
  })

  it('会去除所有句末句号', () => {
    const raw = Array.from({ length: 20 }, (_, i) => `第${i + 1}条评论。`).join('\n')
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments.every((line) => !/[。．.]$/.test(line))).toBe(true)
    expect(result.comments[19]).toBe('第20条评论')
  })

  it('去掉句末句号后仍会正确去重', () => {
    const result = normalizeComments('哈哈。\n哈哈', { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['哈哈'])
    expect(result.removedDuplicate).toBe(1)
  })

  it('会把同一行里被句末符号分隔的多个评论拆开', () => {
    const raw = '1. 这个镜头真的顺，越看越舒服。这个转场也很丝滑！\n3. 结尾稍微仓促了点？'
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual([
      '这个镜头真的顺，越看越舒服',
      '这个转场也很丝滑！',
      '结尾稍微仓促了点？'
    ])
  })

  it('会忽略模型常见的前言并保留真正的评论', () => {
    const raw = [
      '下面是我整理的评论：',
      '1. 这个镜头真的稳，越看越舒服',
      '- 转场也太丝滑了',
      '根据视频内容，这个氛围感真的拉满了',
      '总结：整体挺治愈'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual([
      '这个镜头真的稳，越看越舒服',
      '转场也太丝滑了',
      '这个氛围感真的拉满了'
    ])
  })
})
