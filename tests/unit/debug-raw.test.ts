import { describe, expect, it } from 'vitest'
import { shouldShowDebugRaw } from '../../utils/env'

describe('shouldShowDebugRaw', () => {
  it('仅在开启调试时展示', () => {
    expect(shouldShowDebugRaw(true, 'abc')).toBe(true)
    expect(shouldShowDebugRaw(true, '   ')).toBe(true)
    expect(shouldShowDebugRaw(false, 'abc')).toBe(false)
    expect(shouldShowDebugRaw(true, '', ['prompt a'])).toBe(true)
  })
})
