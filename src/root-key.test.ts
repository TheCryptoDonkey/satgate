import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateRootKey, ROOT_KEY_FILE } from './root-key.js'

describe('loadOrCreateRootKey', () => {
  it('generates a key once and returns the same key afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satgate-key-'))
    const first = loadOrCreateRootKey(dir)
    expect(first.created).toBe(true)
    expect(first.key).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(first.path).mode & 0o777).toBe(0o600)
    const second = loadOrCreateRootKey(dir)
    expect(second.created).toBe(false)
    expect(second.key).toBe(first.key)
  })

  it('refuses a file that does not hold a key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satgate-key-'))
    writeFileSync(join(dir, ROOT_KEY_FILE), 'not a key')
    expect(() => loadOrCreateRootKey(dir)).toThrow(/root key/)
    expect(readFileSync(join(dir, ROOT_KEY_FILE), 'utf-8')).toBe('not a key')
  })
})
