import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { spawn } from 'node:child_process'
import { runProcess } from '../../server/services/process-runner'

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}))

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }

  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()

  return child
}

describe('runProcess', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for close before resolving and captures stdout/stderr', async () => {
    const child = createMockChild()
    vi.mocked(spawn).mockReturnValueOnce(child as any)

    const promise = runProcess({
      command: 'ffmpeg',
      args: ['-version']
    })

    child.stdout.write('hello')
    child.stderr.write('world')
    child.emit('exit', 0, null)

    let settled = false
    promise.then(() => { settled = true }).catch(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0, null)

    await expect(promise).resolves.toEqual(expect.objectContaining({
      stdout: 'hello',
      stderr: 'world',
      exitCode: 0,
      signal: null
    }))
  })

  it('kills the child and rejects when aborted', async () => {
    const child = createMockChild()
    vi.mocked(spawn).mockReturnValueOnce(child as any)

    const controller = new AbortController()
    const promise = runProcess({
      command: 'ffmpeg',
      args: ['-i', 'input.mp4', 'output.mp4'],
      signal: controller.signal
    })

    controller.abort()

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'PROCESS_ABORTED'
    })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
