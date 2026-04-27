import { describe, expect, it, vi, afterEach } from 'vitest'
import { extractDouyinVideoId, fetchDouyinCommentSamplesByAwemeId, parseDouyinLink, resolveDouyinDownloadVideoUrl, toCanonicalDouyinVideoUrl } from '../../server/services/douyin'

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

  it('下载时会优先选择最低画质播放地址', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tikhubApiKey: 'test-key',
      tikhubBaseUrl: 'https://api.tikhub.io'
    }))

    const parsed = {
      ok: true,
      videoUrl: 'https://cdn.example.com/high.mp4',
      awemeId: '7626738541439099121',
      raw: {
        data: {
          aweme_detail: {
            video: {
              bit_rate: [
                {
                  bit_rate: 900000,
                  play_addr: { url_list: ['https://cdn.example.com/high.mp4'] }
                },
                {
                  bit_rate: 120000,
                  play_addr: { url_list: ['https://cdn.example.com/low.mp4'] }
                }
              ]
            }
          }
        }
      }
    } as any

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const selected = await resolveDouyinDownloadVideoUrl(parsed, 'https://v.douyin.com/8_1r_vNADwM/', 'req_test', { region: 'CN' })

    expect(selected).toBe('https://cdn.example.com/low.mp4')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('下载时没有低画质候选时会回退到 region=CN 的链接', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      tikhubApiKey: 'test-key',
      tikhubBaseUrl: 'https://api.tikhub.io'
    }))

    const parsed = {
      ok: true,
      videoUrl: 'https://cdn.example.com/high.mp4',
      awemeId: '7626738541439099121',
      raw: {
        data: {
          aweme_detail: {
            video: {
              play_addr: {
                url_list: ['https://cdn.example.com/high.mp4']
              }
            }
          }
        }
      }
    } as any

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        original_video_url: 'https://cdn.example.com/cn-fallback.mp4'
      }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const selected = await resolveDouyinDownloadVideoUrl(parsed, 'https://v.douyin.com/8_1r_vNADwM/', 'req_test', { region: 'CN' })

    expect(selected).toBe('https://cdn.example.com/cn-fallback.mp4')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('region')).toBe('CN')
  })
})
