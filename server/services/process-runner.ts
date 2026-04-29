import { spawn } from 'node:child_process'

export type RunProcessParams = {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export type RunProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
  signal: NodeJS.Signals | null
}

export class ProcessRunnerError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProcessRunnerError'
    this.code = code
  }
}

export class ProcessRunnerBinaryMissingError extends ProcessRunnerError {
  constructor(command: string) {
    super('PROCESS_BINARY_MISSING', `未找到可执行程序：${command}`)
    this.name = 'ProcessRunnerBinaryMissingError'
  }
}

export class ProcessRunnerExitError extends ProcessRunnerError {
  exitCode: number
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string

  constructor(params: { command: string; exitCode: number; signal: NodeJS.Signals | null; stdout: string; stderr: string }) {
    super(
      'PROCESS_EXIT_NON_ZERO',
      `${params.command} exited with code ${params.exitCode}${params.signal ? ` (${params.signal})` : ''}`
    )
    this.name = 'ProcessRunnerExitError'
    this.exitCode = params.exitCode
    this.signal = params.signal
    this.stdout = params.stdout
    this.stderr = params.stderr
  }
}

export class ProcessRunnerAbortError extends ProcessRunnerError {
  constructor(message: string) {
    super('PROCESS_ABORTED', message)
    this.name = 'AbortError'
  }
}

function toAbortError(reason?: unknown) {
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string' && reason.trim()
      ? reason
      : undefined

  return new ProcessRunnerAbortError(message || 'process aborted')
}

export async function runProcess(params: RunProcessParams): Promise<RunProcessResult> {
  if (params.signal?.aborted) {
    throw toAbortError(params.signal.reason)
  }

  return await new Promise<RunProcessResult>((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let exitCode: number | null = null
    let exitSignal: NodeJS.Signals | null = null

    const cleanup = () => {
      params.signal?.removeEventListener('abort', onAbort)
    }

    const settle = (handler: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      handler()
    }

    const onAbort = () => {
      const abortError = toAbortError(params.signal?.reason)
      child.kill('SIGKILL')
      settle(() => reject(abortError))
    }

    if (params.signal) {
      params.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.once('exit', (code, signal) => {
      exitCode = code
      exitSignal = signal
    })

    child.once('close', () => {
      settle(() => {
        if (exitCode === 0) {
          resolve({
            stdout,
            stderr,
            exitCode: 0,
            signal: exitSignal
          })
          return
        }

        reject(new ProcessRunnerExitError({
          command: params.command,
          exitCode: exitCode ?? 1,
          signal: exitSignal,
          stdout,
          stderr
        }))
      })
    })

    child.once('error', (error: NodeJS.ErrnoException) => {
      settle(() => {
        if (error.code === 'ENOENT') {
          reject(new ProcessRunnerBinaryMissingError(params.command))
          return
        }

        reject(new ProcessRunnerError('PROCESS_RUNNER_FAILED', error.message || `failed to start ${params.command}`))
      })
    })
  })
}
