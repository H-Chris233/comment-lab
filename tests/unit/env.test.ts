import { describe, expect, it } from 'vitest'
import { shouldShowDebugRaw } from '../../utils/env'

describe('shouldShowDebugRaw', () => {
  it('DEBUG_RAW_ENABLED 开启时始终显示调试入口', () => {
    expect(shouldShowDebugRaw(true)).toBe(true)
    expect(shouldShowDebugRaw(true, '', [])).toBe(true)
  })

  it('DEBUG_RAW_ENABLED 关闭时不显示调试入口', () => {
    expect(shouldShowDebugRaw(false)).toBe(false)
    expect(shouldShowDebugRaw(false, '原始输出', ['prompt'])).toBe(false)
  })
})
