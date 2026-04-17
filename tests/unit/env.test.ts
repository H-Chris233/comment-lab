import { describe, expect, it } from 'vitest'
import { parseBooleanEnv } from '../../utils/env'

describe('parseBooleanEnv', () => {
  it('识别 truthy/falsey 环境值', () => {
    expect(parseBooleanEnv('true')).toBe(true)
    expect(parseBooleanEnv('1')).toBe(true)
    expect(parseBooleanEnv('yes')).toBe(true)
    expect(parseBooleanEnv('on')).toBe(true)

    expect(parseBooleanEnv('false')).toBe(false)
    expect(parseBooleanEnv('0')).toBe(false)
    expect(parseBooleanEnv('off')).toBe(false)
    expect(parseBooleanEnv(undefined)).toBe(false)
  })
})
