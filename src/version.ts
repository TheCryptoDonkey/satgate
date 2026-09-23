import { readFileSync } from 'node:fs'

/**
 * satgate's version, from its own package.json.
 *
 * The file sits one level up from src/ when run from source, and two
 * levels up from dist/src/ when compiled, so both are tried. The name is
 * checked so that an unrelated package.json is never read by mistake.
 */
export function readPackageVersion(): string | undefined {
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf-8')) as { name?: string; version?: string }
      if (pkg.name === 'satgate' && typeof pkg.version === 'string') return pkg.version
    } catch {
      // Try the next location
    }
  }
  return undefined
}
