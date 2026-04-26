import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shuffleInPlace, useGenerate } from '../../composables/useGenerate'

describe('useGenerate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
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
    const fetchSpy = vi.mocked(globalThis.fetch)

    const result = await generate({
      mode: 'link',
      inputMode: 'file',
      model: 'qwen3.6-plus',
      url: 'https://v.douyin.com/abcde/',
      count: 1,
      basePrompt: 'base'
    })

    expect(result.ok).toBe(true)

    const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData | undefined
    const entries = body ? Array.from(body.entries()) : []
    const inputMode = entries.find(([key]) => key === 'inputMode')?.[1]
    const model = entries.find(([key]) => key === 'model')?.[1]

    expect(inputMode).toBe('file')
    expect(model).toBe('qwen3.6-plus')
  })

  it('会按短中长轮转重排数组顺序，并且不同轮次起始桶不同', () => {
    const values = [
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '太强了',
      '这个真的很不错，而且挺顺眼的',
      '从开头到结尾都挺顺的，细节也比我想的更完整',
      '哈哈',
      '感觉比想象中顺眼很多，而且挺自然的'
    ]
    const original = values.slice()

    const first = shuffleInPlace(values.slice(), 0)
    const second = shuffleInPlace(values.slice(), 1)

    expect(first).toEqual([
      '太强了',
      '这个真的很不错，而且挺顺眼的',
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '哈哈',
      '感觉比想象中顺眼很多，而且挺自然的',
      '从开头到结尾都挺顺的，细节也比我想的更完整'
    ])
    expect(second).toEqual([
      '这个真的很不错，而且挺顺眼的',
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '太强了',
      '感觉比想象中顺眼很多，而且挺自然的',
      '从开头到结尾都挺顺的，细节也比我想的更完整',
      '哈哈'
    ])
    expect(first).not.toEqual(second)
    expect(values).toEqual(original)
  })

  it('连续点击打乱按钮时会轮换起始桶', () => {
    const { comments, shuffleComments } = useGenerate()
    comments.value = [
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '太强了',
      '这个真的很不错，而且挺顺眼的',
      '从开头到结尾都挺顺的，细节也比我想的更完整',
      '哈哈',
      '感觉比想象中顺眼很多，而且挺自然的'
    ]

    shuffleComments()
    const first = [...comments.value]

    shuffleComments()
    const second = [...comments.value]

    expect(first).toEqual([
      '太强了',
      '这个真的很不错，而且挺顺眼的',
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '哈哈',
      '感觉比想象中顺眼很多，而且挺自然的',
      '从开头到结尾都挺顺的，细节也比我想的更完整'
    ])
    expect(second).toEqual([
      '这个真的很不错，而且挺顺眼的',
      '这个真的比我想的还要细很多，细节也更完整，越看越舒服',
      '太强了',
      '感觉比想象中顺眼很多，而且挺自然的',
      '从开头到结尾都挺顺的，细节也比我想的更完整',
      '哈哈'
    ])
    expect(first).not.toEqual(second)
  })
})
