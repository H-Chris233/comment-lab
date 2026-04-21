import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shuffleInPlace, useGenerate } from '../../composables/useGenerate'

describe('useGenerate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as FormData | undefined
    const entries = body ? Array.from(body.entries()) : []
    const inputMode = entries.find(([key]) => key === 'inputMode')?.[1]
    const model = entries.find(([key]) => key === 'model')?.[1]

    expect(inputMode).toBe('file')
    expect(model).toBe('qwen3.6-plus')

      return new Response(
        'event: done\ndata: {"ok":true,"data":{"comments":[],"rawText":"","promptTrace":[],"requestedCount":1,"finalCount":0,"beforeNormalizeCount":0,"afterNormalizeCount":0,"model":"test"},"requestId":"req_test"}\n\n',
        {
          headers: {
            'Content-Type': 'text/event-stream'
          }
        }
      )
    }) as any)
  })

  it('会把 inputMode 带到生成请求里', async () => {
    const { generate } = useGenerate()

    const result = await generate({
      mode: 'link',
      inputMode: 'file',
      model: 'qwen3.6-plus',
      url: 'https://v.douyin.com/abcde/',
      count: 1,
      basePrompt: 'base'
    })

    expect(result.ok).toBe(true)
  })

  it('会原地打乱数组顺序', () => {
    const values = ['a', 'b', 'c', 'd']
    const original = values
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    const result = shuffleInPlace(values)

    expect(result).toBe(original)
    expect(result).toEqual(['b', 'c', 'd', 'a'])

    random.mockRestore()
  })
})
