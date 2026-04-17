import { describe, expect, it } from 'vitest'
import { normalizeCommentItems, normalizeComments, parseJsonComments } from '../../server/services/normalize'

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

  it('json 数组模式可以独立清洗', () => {
    const result = normalizeCommentItems(['  1. 真的好看  ', '评论如下', '真的好看', '哈哈'], { dedupe: true, cleanEmpty: true })
    expect(result.comments).toEqual(['真的好看', '哈哈'])
  })

  it('parseJsonComments 仅接受 JSON 数组', () => {
    expect(parseJsonComments('["a","b"]')).toEqual(['a', 'b'])
    expect(parseJsonComments('{"a":1}')).toBeNull()
    expect(parseJsonComments('not json')).toBeNull()
  })
})
