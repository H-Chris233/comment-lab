import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerate } from '../../composables/useGenerate'

describe('useGenerate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData | undefined
      const entries = body ? Array.from(body.entries()) : []
      const inputMode = entries.find(([key]) => key === 'inputMode')?.[1]

      expect(inputMode).toBe('file')

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
      url: 'https://v.douyin.com/abcde/',
      count: 1,
      basePrompt: 'base'
    })

    expect(result.ok).toBe(true)
  })
})
