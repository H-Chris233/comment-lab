import { describe, expect, it, vi, afterEach } from 'vitest'
import { extractDouyinVideoId, parseDouyinLink, toCanonicalDouyinVideoUrl } from '../../server/services/douyin'

describe('douyin url normalize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('能提取 video id 并构造标准链接', () => {
    expect(extractDouyinVideoId('https://www.douyin.com/video/7626738541439099121')).toBe('7626738541439099121')
    expect(extractDouyinVideoId('https://www.iesdouyin.com/share/video/7626738541439099121/?x=1')).toBe('7626738541439099121')
    expect(toCanonicalDouyinVideoUrl('7626738541439099121')).toBe('https://www.douyin.com/video/7626738541439099121')
  })

  it('分享文案可通过 TikHub 解析出视频直链', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tikhubApiKey: 'test-key',
      tikhubBaseUrl: 'https://api.tikhub.io'
    }))

    const sharedText = '复制打开抖音 https://v.douyin.com/8_1r_vNADwM/ 05/14 m@D.ho LJV:/'
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        aweme_detail: {
          desc: '示例标题',
          video: {
            play_addr: {
              url_list: ['https://v3-dy-o.zjcdn.com/test-video.mp4']
            },
            cover: {
              url_list: ['https://p3-dy-o.zjcdn.com/test-cover.jpeg']
            }
          }
        }
      }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const parsed = await parseDouyinLink(sharedText, 'req_test')
    expect(parsed.videoUrl).toBe('https://v3-dy-o.zjcdn.com/test-video.mp4')
    expect(parsed.title).toBe('示例标题')
    expect(parsed.cover).toBe('https://p3-dy-o.zjcdn.com/test-cover.jpeg')
  })
})
