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
})
