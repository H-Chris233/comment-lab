import { describe, expect, it, vi, afterEach } from 'vitest'
import { extractDouyinVideoId, normalizeDouyinVideoUrl, toCanonicalDouyinVideoUrl } from '../../server/services/douyin'

describe('douyin url normalize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('能提取 video id 并构造标准链接', () => {
    expect(extractDouyinVideoId('https://www.douyin.com/video/7626738541439099121')).toBe('7626738541439099121')
    expect(extractDouyinVideoId('https://www.iesdouyin.com/share/video/7626738541439099121/?x=1')).toBe('7626738541439099121')
    expect(toCanonicalDouyinVideoUrl('7626738541439099121')).toBe('https://www.douyin.com/video/7626738541439099121')
  })

  it('分享文案可提取短链并跳转为标准 video 链接', async () => {
    const sharedText = '复制打开抖音 https://v.douyin.com/8_1r_vNADwM/ 05/14 m@D.ho LJV:/'

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 302,
        headers: {
          location: 'https://www.iesdouyin.com/share/video/7626738541439099121/?region=CN&x=1'
        }
      }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    const normalized = await normalizeDouyinVideoUrl(sharedText)
    expect(normalized).toBe('https://www.douyin.com/video/7626738541439099121')
  })
})
