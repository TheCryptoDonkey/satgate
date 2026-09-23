import { readFileSync } from 'node:fs'

/**
 * satgate's version, from its own package.json.
 *
 * The file sits one level up from src/ when run from source, and two
 * levels up from dist/src/ when compiled, so both are tried. The name is
 * checked so that an unrelated package.json is never read by mistake.
 *
 * `base` is this module's URL; tests pass another to exercise a layout.
 */
export function readPackageVersion(base: string | URL = import.meta.url): string | undefined {
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(relative, base), 'utf-8')) as { name?: string; version?: string }
      if (pkg.name === 'satgate' && typeof pkg.version === 'string') return pkg.version
    } catch {
      // Try the next location
    }
  }
  return undefined
}
