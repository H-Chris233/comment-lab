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
    const raw = '1. 这个画面真的顺，越看越舒服。这个节奏也很丝滑！\n3. 结尾稍微仓促了点？'
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual([
      '这个画面真的顺，越看越舒服',
      '这个节奏也很丝滑！',
      '结尾稍微仓促了点？'
    ])
  })

  it('会忽略模型常见的前言并保留真正的评论', () => {
    const raw = [
      '下面是我整理的评论：',
      '1. 这个画面真的稳，越看越舒服',
      '- 节奏也太丝滑了',
      '根据视频内容，这个氛围感真的拉满了',
      '总结：整体挺治愈'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual([
      '这个画面真的稳，越看越舒服',
      '节奏也太丝滑了',
      '这个氛围感真的拉满了'
    ])
  })

  it('会过滤指定营销化表达和拍摄手法描述', () => {
    const raw = [
      '博主这段太会了',
      '这个运镜不错',
      '笑死我了',
      '太丝滑了吧',
      '这个节奏很丝滑',
      '主包这段挺自然'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['这个节奏很丝滑', '主包这段挺自然'])
    expect(result.removedInvalid).toBe(4)
  })

  it('会过滤测评腔和广告对比腔', () => {
    const raw = [
      '这种测评看看才真实',
      '不像有些广告吹得天花乱坠',
      '实测之后确实挺猛',
      '这个感觉还是挺自然'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['这个感觉还是挺自然'])
    expect(result.removedInvalid).toBe(3)
  })

  it('会过滤帧率和开头片段这类拍法评价', () => {
    const raw = [
      '这帧率绝了',
      '开头那段绝了',
      '讲拍摄手法的评论',
      '这个感觉还是很自然'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['这个感觉还是很自然'])
    expect(result.removedInvalid).toBe(3)
  })
})
