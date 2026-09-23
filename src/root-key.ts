import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/** File name of the persisted root key, kept beside the SQLite database. */
export const ROOT_KEY_FILE = 'satgate.root-key'

/**
 * Loads the macaroon root key from `dir`, or generates one and saves it
 * there (mode 0600). Credentials are signed with this key, so if it
 * changed on every restart, every credential a client had paid for would
 * stop working while its balance sat in the database.
 */
export function loadOrCreateRootKey(dir: string): { key: string; path: string; created: boolean } {
  const path = join(dir, ROOT_KEY_FILE)
  let existing: string | undefined
  try {
    existing = readFileSync(path, 'utf-8').trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (existing !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(existing)) {
      throw new Error(`${path} does not hold a 64-hex-character root key`)
    }
    return { key: existing, path, created: false }
  }
  const key = randomBytes(32).toString('hex')
  mkdirSync(dir, { recursive: true })
  // 'wx' fails if another process created the file first
  writeFileSync(path, `${key}\n`, { mode: 0o600, flag: 'wx' })
  return { key, path, created: true }
}
