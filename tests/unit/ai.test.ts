import { describe, expect, it, vi } from 'vitest'

import { countCompleteItemsByLines, createCompleteLineCollector, generateFromVideoFile } from '../../server/services/ai'

describe('countCompleteItemsByLines', () => {
  it('只统计完整行，不把最后一条未完成文本算进去', () => {
    const raw = [
      '第一条',
      '第二条',
      '第三条',
      '第四条',
      '第五条',
      '第六条',
      '第七条',
      '第八条',
      '第九条',
      '第十条',
      '第十一条',
      '第十二条',
      '第十三条',
      '第十四条',
      '第十五条',
      '第十六条',
      '第十七条',
      '第十八条',
      '第十九条',
      '第二十条',
      '第二十一条',
      '第二十二条',
      '第二十三条',
      '第二十四条',
      '第二十五条',
      '第二十六条',
      '第二十七条',
      '第二十八条',
      '第二十九条',
      '第三十条',
      '第三十一条',
      '第三十二条',
      '第三十三条',
      '第三十四条',
      '第三十五条',
      '第三十六条',
      '第三十七条',
      '第三十八条',
      '第三十九条',
      '第四十条',
      '第四十一条',
      '第四十二条',
      '第四十三条',
      '第四十四条',
      '第四十五条',
      '第四十六条',
      '第四十七条',
      '第四十八条',
      '第四十九条',
      '第五十条',
      '第五十一条',
      '第五十二条',
      '第五十三条',
      '第五十四条',
      '第五十五条',
      '第五十六条',
      '第五十七条',
      '第五十八条',
      '第五十九条',
      '第六十'
    ].join('\n')

    expect(countCompleteItemsByLines(raw)).toBe(59)
  })

  it('完整换行后的第 60 条会被正常计入', () => {
    const raw = `${Array.from({ length: 59 }, (_, i) => `第${i + 1}条`).join('\n')}\n第60条\n`

    expect(countCompleteItemsByLines(raw)).toBe(60)
  })
})

describe('createCompleteLineCollector', () => {
  it('只输出新完成的评论，不会重复吐出已经处理过的行', () => {
    const collector = createCompleteLineCollector()

    expect(collector.collect('第一条\n第二')).toEqual(['第一条'])
    expect(collector.collect('第一条\n第二条\n第三')).toEqual(['第二条'])
    expect(collector.collect('第一条\n第二条\n第三条\n')).toEqual(['第三条'])
  })
})

describe('generateFromVideoFile', () => {
  it('会把本地视频以 file 路径传给 Python 侧车', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        rawText: '第一条\n第二条\n'
      })
    })
    vi.stubGlobal('fetch', fetchMock as any)
    try {
      const onLine = vi.fn()
      const result = await generateFromVideoFile({
        model: 'qwen3.6-plus',
        prompt: 'base prompt',
        videoPath: '/tmp/video.mp4',
        requestId: 'req_test',
        onLine
      })

      expect(result.rawText).toContain('第一条')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/generate')
      expect(init.method).toBe('POST')
      const body = JSON.parse(String(init.body)) as any
      expect(body.model).toBe('qwen3.6-plus')
      expect(body.input_mode).toBe('file')
      expect(body.video_path).toBe('/tmp/video.mp4')
      expect(onLine).toHaveBeenCalledWith('第一条')
      expect(onLine).toHaveBeenCalledWith('第二条')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('侧车临时网络失败时会自动重试后成功', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rawText: '第一条\n第二条\n'
        })
      })
    vi.stubGlobal('fetch', fetchMock as any)

    try {
      const result = await generateFromVideoFile({
        model: 'qwen3.6-plus',
        prompt: 'base prompt',
        videoPath: '/tmp/video.mp4',
        requestId: 'req_test_retry'
      })

      expect(result.rawText).toContain('第一条')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('侧车返回非临时错误时不会重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'internal error'
      })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    try {
      await expect(generateFromVideoFile({
        model: 'qwen3.6-plus',
        prompt: 'base prompt',
        videoPath: '/tmp/video.mp4',
        requestId: 'req_test_no_retry'
      })).rejects.toThrow('internal error')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
