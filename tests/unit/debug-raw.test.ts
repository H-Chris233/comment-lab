import { describe, expect, it } from 'vitest'
import { shouldShowDebugRaw } from '../../utils/env'

describe('shouldShowDebugRaw', () => {
  it('仅在开启调试且有原始文本时展示', () => {
    expect(shouldShowDebugRaw(true, 'abc')).toBe(true)
    expect(shouldShowDebugRaw(true, '   ')).toBe(false)
    expect(shouldShowDebugRaw(false, 'abc')).toBe(false)
  })
})
