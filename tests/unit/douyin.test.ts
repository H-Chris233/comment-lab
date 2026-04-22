import { describe, expect, it, vi, afterEach } from 'vitest'
import { extractDouyinVideoId, fetchDouyinCommentSamplesByAwemeId, parseDouyinLink, toCanonicalDouyinVideoUrl } from '../../server/services/douyin'

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

  it('可从 TikHub 评论接口提取原始评论样本', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tikhubApiKey: 'test-key',
      tikhubBaseUrl: 'https://api.tikhub.io'
    }))

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      code: 200,
      data: {
        comments: [
          { text: '这个镜头真的好舒服' },
          { text: '主包这段状态太松弛了' },
          { text: '这个镜头真的好舒服' }
        ]
      }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const samples = await fetchDouyinCommentSamplesByAwemeId(
      'https://v.douyin.com/8_1r_vNADwM/',
      '7372484719365098803',
      'req_test'
    )

    expect(samples).toEqual([
      '这个镜头真的好舒服',
      '主包这段状态太松弛了'
    ])
  })

  it('解析视频时会优先尝试 app/v3 endpoint', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tikhubApiKey: 'test-key',
      tikhubBaseUrl: 'https://api.tikhub.io'
    }))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          aweme_detail: {
            video: {
              play_addr: {
                url_list: ['https://v3-dy-o.zjcdn.com/test-video.mp4']
              }
            }
          }
        }
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const parsed = await parseDouyinLink('https://v.douyin.com/8_1r_vNADwM/', 'req_test')

    expect(parsed.videoUrl).toBe('https://v3-dy-o.zjcdn.com/test-video.mp4')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe('/api/v1/douyin/app/v3/fetch_one_video_by_share_url')
    expect(infoSpy).toHaveBeenCalled()
  })
})
