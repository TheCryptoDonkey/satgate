import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readPackageVersion } from '../../src/version.js'
import { lightningLabel } from '../../src/cli.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('readPackageVersion', () => {
  it('reads the real version when run from source', () => {
    expect(readPackageVersion()).toBe(manifest.version)
  })

  it('reads the package root from the compiled dist/src layout', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'satgate-pkg-'))
    mkdirSync(join(pkg, 'dist', 'src'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'satgate', version: '9.8.7' }))
    // A dist/package.json that is not satgate's must be ignored
    writeFileSync(join(pkg, 'dist', 'package.json'), JSON.stringify({ name: 'other', version: '0.0.0' }))
    const compiledModule = pathToFileURL(join(pkg, 'dist', 'src', 'version.js'))
    expect(readPackageVersion(compiledModule)).toBe('9.8.7')
  })
})

describe('lightningLabel', () => {
  it('omits the URL for nwc, which has none', () => {
    expect(lightningLabel({ lightning: 'nwc', lightningUrl: undefined })).toBe('nwc')
  })

  it('shows the URL for URL-based backends', () => {
    expect(lightningLabel({ lightning: 'phoenixd', lightningUrl: 'http://localhost:9740' })).toBe('phoenixd (http://localhost:9740)')
  })
})
