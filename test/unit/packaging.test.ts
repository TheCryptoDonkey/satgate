import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('npm package contents', () => {
  it('copies the landing page into the build output during the build', () => {
    expect(manifest.scripts.build).toContain('scripts/copy-page.mjs')
    const out = mkdtempSync(join(tmpdir(), 'satgate-dist-'))
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'copy-page.mjs'), out], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    // dist/src/server.js looks for ../page/index.html
    expect(existsSync(join(out, 'page', 'index.html'))).toBe(true)
  })

  it('publishes the build output', () => {
    expect(manifest.files).toContain('dist')
  })
})

describe('Docker image', () => {
  it('exposes the port satgate listens on by default', async () => {
    const { loadConfig } = await import('../../src/config.js')
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const exposed = /^EXPOSE (\d+)$/m.exec(dockerfile)?.[1]
    expect(Number(exposed)).toBe(loadConfig({ upstream: 'http://x' }).port)
  })
})
