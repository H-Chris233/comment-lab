import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shuffleInPlace, useGenerate } from '../../composables/useGenerate'

const EMOJI_SEQUENCE_RE = /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*|[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2})/gu
const LENGTH_IGNORE_RE = /[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]/g
const LEADING_DECORATOR_RE = /^[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]+/u

function getBucket(text: string) {
  const length = text.replace(EMOJI_SEQUENCE_RE, '').replace(LENGTH_IGNORE_RE, '').length
  if (length <= 10) return 'short'
  if (length <= 18) return 'medium'
  return 'long'
}

function stripLeadingDecorators(text: string) {
  let value = text.trim()

  while (true) {
    const before = value
    const punctuation = value.match(LEADING_DECORATOR_RE)
    if (punctuation) {
      value = value.slice(punctuation[0].length)
    }

    const emoji = value.match(EMOJI_SEQUENCE_RE)?.[0]
    if (emoji && value.startsWith(emoji)) {
      value = value.slice(emoji.length)
    }

    if (value === before) break
  }

  return value
}

function getOpeningKey(text: string) {
  return Array.from(stripLeadingDecorators(text)).slice(0, 2).join('')
}

function maxConsecutiveBucketRun(values: string[]) {
  if (!values.length) return 0

  let maxRun = 1
  let currentRun = 1
  let lastBucket = getBucket(values[0])

  for (const value of values.slice(1)) {
    const bucket = getBucket(value)
    if (bucket === lastBucket) {
      currentRun += 1
    } else {
      maxRun = Math.max(maxRun, currentRun)
      currentRun = 1
      lastBucket = bucket
    }
  }

  return Math.max(maxRun, currentRun)
}

function maxConsecutiveOpeningKeyRun(values: string[]) {
  if (!values.length) return 0

  let maxRun = 1
  let currentRun = 1
  let lastKey = getOpeningKey(values[0])

  for (const value of values.slice(1)) {
    const key = getOpeningKey(value)
    if (key === lastKey) {
      currentRun += 1
    } else {
      maxRun = Math.max(maxRun, currentRun)
      currentRun = 1
      lastKey = key
    }
  }

  return Math.max(maxRun, currentRun)
}

function maxConsecutiveSameOpeningPairRun(values: string[]) {
  if (values.length < 2) return 0

  let maxRun = 1
  let currentRun = 1
  let lastKey = getOpeningKey(values[0])

  for (const value of values.slice(1)) {
    const key = getOpeningKey(value)
    if (key === lastKey) {
      currentRun += 1
    } else {
      maxRun = Math.max(maxRun, currentRun)
      currentRun = 1
      lastKey = key
    }
  }

  return Math.max(maxRun, currentRun)
}

const SHUFFLE_SAMPLE_VALUES = [
  '那个真稳',
  '这个真稳',
  '我看真稳',
  '感觉真稳',
  '那个真的挺稳当',
  '这个真的挺稳当',
  '我看真的挺稳当',
  '感觉真的挺稳当',
  '那个真的挺稳当，而且越看越顺',
  '这个真的挺稳当，而且越看越顺',
  '我看真的挺稳当，而且越看越顺',
  '感觉真的挺稳当，而且越看越顺'
]

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
      enableThinking: true,
      url: 'https://v.douyin.com/abcde/',
      count: 1,
      basePrompt: 'base'
    })

    expect(result.ok).toBe(true)

    const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData | undefined
    const entries = body ? Array.from(body.entries()) : []
    const inputMode = entries.find(([key]) => key === 'inputMode')?.[1]
    const model = entries.find(([key]) => key === 'model')?.[1]
    const enableThinking = entries.find(([key]) => key === 'enableThinking')?.[1]

    expect(inputMode).toBe('file')
    expect(model).toBe('qwen3.6-plus')
    expect(enableThinking).toBe('true')
  })

  it('不会给生成请求额外挂超时定时器', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const { generate } = useGenerate()

    await generate({
      mode: 'link',
      inputMode: 'file',
      model: 'qwen3.6-plus',
      enableThinking: true,
      url: 'https://v.douyin.com/abcde/',
      count: 1,
      basePrompt: 'base'
    })

    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })

  it('会避免同一长度桶连续超过 3 条', () => {
    const values = SHUFFLE_SAMPLE_VALUES
    const original = values.slice()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const result = shuffleInPlace(values.slice(), 0)

    expect(maxConsecutiveBucketRun(result)).toBeLessThanOrEqual(3)
    expect(result.slice().sort()).toEqual(values.slice().sort())
    expect(values).toEqual(original)

    randomSpy.mockRestore()
  })

  it('不同随机序列会得到不同打乱结果，但不会依赖轮转状态', () => {
    const values = SHUFFLE_SAMPLE_VALUES.slice()
    const original = values.slice()

    const firstRandomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)

    const first = shuffleInPlace(values.slice())
    firstRandomSpy.mockRestore()

    const secondRandomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)

    const second = shuffleInPlace(values.slice())
    secondRandomSpy.mockRestore()

    expect(first).not.toEqual(second)
    expect(maxConsecutiveBucketRun(first)).toBeLessThanOrEqual(3)
    expect(maxConsecutiveBucketRun(second)).toBeLessThanOrEqual(3)
    expect(maxConsecutiveSameOpeningPairRun(first)).toBeLessThanOrEqual(2)
    expect(maxConsecutiveSameOpeningPairRun(second)).toBeLessThanOrEqual(2)
    expect(values).toEqual(original)
  })

  it('不会改变原数组内容', () => {
    const values = SHUFFLE_SAMPLE_VALUES.slice()
    const original = values.slice()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const result = shuffleInPlace(values.slice(), 0)

    expect(result).toHaveLength(values.length)
    expect(values).toEqual(original)

    randomSpy.mockRestore()
  })
})
