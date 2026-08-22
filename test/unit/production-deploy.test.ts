import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(new URL('../../deploy/production.sh', import.meta.url))
const source = readFileSync(scriptPath, 'utf8')
const dockerfile = readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8')

describe('production Satgate deployment', () => {
  it('has valid Bash syntax', () => {
    expect(spawnSync('bash', ['-n', scriptPath]).status).toBe(0)
  })

  it('fails before side effects when configuration is absent', () => {
    const result = spawnSync(scriptPath, [], {
      encoding: 'utf8',
      env: { ...process.env, DEPLOY_REF: 'v1.2.3', CONFIG_FILE: '/nonexistent' },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing deployment configuration')
  })

  it('pins deployment, persists identity, and records proof', () => {
    expect(source).toContain('refs/tags/$DEPLOY_REF^{commit}')
    expect(source).toContain('worktree add --detach')
    expect(source).toContain('if [[ ! -d "$RUNTIME_DIR/data" ]]')
    expect(source).toContain('--env-file')
    expect(source).toContain('.announce-key')
    expect(source).toContain('data/announce.key')
    expect(source).toContain('/home/satgate/.satgate/announce.key')
    expect(source).toContain('deployed-commit')
    expect(source).toContain('rollback')
    expect(source).toContain('refusing identity replacement')
    expect(source).not.toContain('origin/main')
    expect(source).not.toMatch(/\|\|\s*echo\s+[0-9a-f]{32,}/)
  })

  // The spending credential, since the wallet moved off this box on
  // 2026-08-17. It used to be a phoenixd password read from a container,
  // and the guard was that the LIMITED-access one was read and never the
  // full one. There is no such pair now: what the box holds is an NWC URI
  // restricted to make_invoice and lookup_invoice, and the guards that
  // matter are that it must exist and must never become an env value.
  it('takes its wallet credential from a file, never from the environment', () => {
    expect(source).toContain('nwc-uri.txt')
    expect(source).toContain('Missing NWC URI file')
    // A path is passed to the container; the URI itself is not, because
    // environment values are readable from the process table and this one
    // is a bearer credential.
    expect(source).toMatch(/LIGHTNING_KEY=\/app\/data\/nwc-uri\.txt/)
    expect(source).not.toContain('nostr+walletconnect://')
    expect(source).not.toMatch(/LIGHTNING_KEY=%s/)
    // And the old arrangement is gone rather than half-present.
    expect(source).not.toContain('http-password')
  })

  it('uses lockfile-strict Docker installs', () => {
    expect(dockerfile).toContain('RUN npm ci')
    expect(dockerfile).toContain('RUN npm prune --omit=dev')
    expect(dockerfile).toContain('COPY --from=build /build/node_modules/ ./node_modules/')
    expect(dockerfile).not.toContain('RUN npm install')
    expect(dockerfile).not.toContain('file: dev dependency')
  })
})
