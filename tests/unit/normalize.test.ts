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

  it('会过滤新增的禁用句式', () => {
    const raw = [
      '这个选题很种草',
      '允许泛化',
      '前面更好看',
      '笑死我了',
      '有点上头啊',
      '刷到就看完',
      '怎么拍的？',
      '这个评论还是挺自然'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['有点上头啊', '这个评论还是挺自然'])
    expect(result.removedInvalid).toBe(6)
  })

  it('会过滤 bundle 分段标题', () => {
    const raw = [
      '【16 字】',
      '这个长度还挺顺',
      '【17字】',
      '再来一条'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })

    expect(result.comments).toEqual(['这个长度还挺顺', '再来一条'])
    expect(result.removedInvalid).toBe(2)
  })

  it('会按条数硬控 emoji 数量，而不是全部清除', () => {
    const raw = [
      '😎这个真的好看😂',
      '中间放个👍表情也行',
      '纯Emoji😅'
    ].join('\n')

    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })
    const keptEmojiCount = result.comments.reduce((sum, line) => {
      return sum + (line.match(/\p{Extended_Pictographic}/gu)?.length ?? 0)
    }, 0)

    expect(result.comments.some((line) => /\p{Extended_Pictographic}/u.test(line))).toBe(true)
    expect(keptEmojiCount).toBeGreaterThan(0)
    expect(keptEmojiCount).toBeLessThanOrEqual(1)
    expect(result.comments.some((line) => line.includes('这个真的好看'))).toBe(true)
    expect(result.comments.some((line) => line.includes('中间放个') && line.includes('表情也行'))).toBe(true)
    expect(result.comments.some((line) => line.includes('纯Emoji'))).toBe(true)
  })

  it('会把 100 条中的 emoji 数量硬控在 10 个以内', () => {
    const raw = Array.from({ length: 100 }, (_, i) => `第${i + 1}条😎评论😂`).join('\n')
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })
    const keptEmojiCount = result.comments.reduce((sum, line) => {
      return sum + (line.match(/\p{Extended_Pictographic}/gu)?.length ?? 0)
    }, 0)

    expect(result.comments.length).toBe(100)
    expect(keptEmojiCount).toBeGreaterThan(0)
    expect(keptEmojiCount).toBeLessThanOrEqual(10)
  })

  it('会按比例把一部分逗号替换为空格和句末标点', () => {
    const raw = Array.from({ length: 10 }, (_, i) => `第${i + 1}条，前半句，后半句，结尾部分`).join('\n')
    const result = normalizeComments(raw, { dedupe: true, cleanEmpty: true })
    const joined = result.comments.join('\n')

    expect(joined).toContain(' ')
    expect(/[。！？]/.test(joined)).toBe(true)
    expect(joined.includes('，')).toBe(true)
  })

  it('可以通过参数覆盖 emoji 和逗号比例', () => {
    const raw = '😎这个真的好看😂，中间放个👍表情也行，纯Emoji😅'
    const result = normalizeComments(raw, {
      dedupe: true,
      cleanEmpty: true,
      emojiRatio: 4,
      commaSpaceRatio: 1,
      commaPeriodRatio: 0
    })

    expect(result.comments.join('')).toContain('😎')
    expect(result.comments.join('')).toContain('😂')
    expect(result.comments.join('')).toContain('😅')
    expect(result.comments.join('')).not.toContain('，')
    expect(result.comments.join('')).not.toContain('。')
  })
})
