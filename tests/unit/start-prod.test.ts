import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('production start script', () => {
  it('应提供非 Docker 生产一键启动脚本', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    expect(packageJson.scripts?.['start:prod']).toBe('bash scripts/prod-all.sh')

    const script = await readFile('scripts/prod-all.sh', 'utf8')
    expect(script).toContain('npm run build')
    expect(script).toContain('npm run preview')
    expect(script).toContain('uv run --directory "$ROOT_DIR/python_service" --python 3.13 uvicorn app:app --port 8001')
    expect(script).toContain('trap cleanup EXIT INT TERM')
  })
})
