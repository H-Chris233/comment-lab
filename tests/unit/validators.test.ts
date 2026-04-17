import { describe, expect, it } from 'vitest'
import { validateCount, validatePromptLength, validateUrl, validateVideoFile } from '../../server/utils/validators'

describe('validators', () => {
  it('validateCount 支持预设和自定义范围', () => {
    expect(validateCount('100')).toBe(100)
    expect(validateCount('37')).toBe(37)
    expect(() => validateCount('0')).toThrowError(/自定义数量范围为 1~500/)
    expect(() => validateCount('501')).toThrowError(/自定义数量范围为 1~500/)
  })

  it('validatePromptLength 限制长度', () => {
    expect(validatePromptLength('abc', 'def')).toEqual({ basePrompt: 'abc', extraPrompt: 'def' })
    expect(() => validatePromptLength(' ', '')).toThrowError(/默认提示词不能为空/)
    expect(() => validatePromptLength('a'.repeat(6001), '')).toThrowError(/6000/)
    expect(() => validatePromptLength('ok', 'b'.repeat(2001))).toThrowError(/2000/)
  })

  it('validateUrl 仅允许 http/https', () => {
    expect(validateUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(() => validateUrl('ftp://example.com')).toThrowError(/http\/https/)
  })

  it('validateVideoFile 校验大小和类型', () => {
    const file = { type: 'video/mp4', data: Buffer.from('123') }
    expect(validateVideoFile(file, 10, ['video/mp4'])).toBe(file)
    expect(() => validateVideoFile({ type: 'image/png', data: Buffer.from('1') }, 10, ['video/mp4'])).toThrowError(/仅支持/)
    expect(() => validateVideoFile({ type: 'video/mp4', data: Buffer.alloc(20) }, 10, ['video/mp4'])).toThrowError(/超过限制/)
  })
})
