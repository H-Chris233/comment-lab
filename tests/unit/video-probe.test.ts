import { describe, expect, it, vi, afterEach } from 'vitest'

import { probeVideoFileForModel } from '../../server/services/video-probe'
import { runProcess } from '../../server/services/process-runner'

vi.mock('../../server/services/process-runner', () => ({
  runProcess: vi.fn()
}))

describe('probeVideoFileForModel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.FFMPEG_BINARY
  })

  it('logs ffmpeg-derived video metadata for valid files', async () => {
    vi.mocked(runProcess).mockResolvedValueOnce({
      stdout: '',
      stderr: [
        'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from "video.mp4":',
        '  Duration: 00:00:03.20, start: 0.000000, bitrate: 8627 kb/s',
        '  Stream #0:0: Video: h264 (High), yuv420p, 720x1280, 30 fps'
      ].join('\n'),
      exitCode: 0,
      signal: null
    })

    const result = await probeVideoFileForModel({
      sourcePath: '/tmp/video.mp4',
      bytes: 3_450_786,
      requestId: 'req_test_probe',
      stepLabel: 'link-download'
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      bytes: 3_450_786,
      format: 'mov',
      duration: '00:00:03.20',
      videoCodec: 'h264',
      resolution: '720x1280'
    }))
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: 'ffmpeg',
      args: expect.arrayContaining([
        '-map',
        '0:v:0',
        '-frames:v',
        '1'
      ])
    }))
  })

  it('turns invalid video probe failures into an actionable app error', async () => {
    vi.mocked(runProcess).mockRejectedValueOnce(
      Object.assign(new Error('ffmpeg exited 1'), {
        code: 'PROCESS_EXIT_NON_ZERO',
        stderr: 'Invalid data found when processing input'
      })
    )

    await expect(probeVideoFileForModel({
      sourcePath: '/tmp/broken.mp4',
      bytes: 3_450_786,
      requestId: 'req_test_probe_invalid',
      stepLabel: 'link-download'
    })).rejects.toMatchObject({
      name: 'AppError',
      code: 'VIDEO_INVALID',
      statusCode: 422,
      data: {
        bytes: 3_450_786,
        reason: 'Invalid data found when processing input'
      }
    })
  })

  it('does not block generation when ffmpeg is unavailable for probing', async () => {
    vi.mocked(runProcess).mockRejectedValueOnce(
      Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'PROCESS_BINARY_MISSING' })
    )

    await expect(probeVideoFileForModel({
      sourcePath: '/tmp/video.mp4',
      bytes: 4,
      requestId: 'req_test_probe_missing',
      stepLabel: 'upload'
    })).resolves.toEqual({
      ok: true,
      bytes: 4
    })
  })
})
