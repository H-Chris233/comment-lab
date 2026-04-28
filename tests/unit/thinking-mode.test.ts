import { describe, expect, it } from 'vitest'
import { supportsThinkingMode } from '../../types/prompt'

describe('supportsThinkingMode', () => {
  it('仅 plus 模型支持思考参数', () => {
    expect(supportsThinkingMode('qwen3.5-plus')).toBe(true)
    expect(supportsThinkingMode('qwen3.5-plus-2026-02-15')).toBe(true)
    expect(supportsThinkingMode('qwen3.6-plus')).toBe(true)
    expect(supportsThinkingMode('qwen3.6-plus-2026-04-02')).toBe(true)

    expect(supportsThinkingMode('qwen3.5-omni-plus')).toBe(false)
    expect(supportsThinkingMode('qwen3.6-flash')).toBe(false)
    expect(supportsThinkingMode('')).toBe(false)
    expect(supportsThinkingMode(undefined)).toBe(false)
  })
})
