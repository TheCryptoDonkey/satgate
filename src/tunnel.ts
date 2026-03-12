import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

/**
 * Check if cloudflared is available on PATH.
 * Returns the path to the binary, or null if not found.
 * Note: uses `which` — works on macOS/Linux, not Windows.
 */
export function findCloudflared(): string | null {
  try {
    const result = execFileSync('which', ['cloudflared'], { encoding: 'utf-8', timeout: 5000 })
    return result.trim() || null
  } catch {
    return null
  }
}

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/**
 * Parse the tunnel URL from cloudflared's stderr output.
 */
export function parseTunnelUrl(output: string): string | undefined {
  const match = output.match(TUNNEL_URL_RE)
  return match?.[0]
}

export interface TunnelResult {
  url?: string
  process?: ChildProcess
  error?: string
}

/**
 * Start a Cloudflare Tunnel pointing at the given local port.
 * Resolves when the tunnel URL is available or after a 10s timeout.
 */
export function startTunnel(port: number): Promise<TunnelResult> {
  const cloudflaredPath = findCloudflared()
  if (!cloudflaredPath) {
    return Promise.resolve({
      error: 'cloudflared not found. Install: brew install cloudflared',
    })
  }

  return new Promise((resolve) => {
    const child = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    const MAX_STDERR = 64 * 1024 // 64 KiB cap to prevent unbounded memory growth
    const timeout = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
      resolve({ error: 'Tunnel startup timed out (10s)' })
    }, 10_000)

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) {
        stderr += chunk.toString()
        if (stderr.length > MAX_STDERR) stderr = stderr.slice(0, MAX_STDERR)
      }
      const url = parseTunnelUrl(stderr)
      if (url) {
        clearTimeout(timeout)
        resolve({ url, process: child })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ error: `Failed to start cloudflared: ${err.message}` })
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code !== null && code !== 0) {
        resolve({ error: `cloudflared exited with code ${code}` })
      }
    })
  })
}

/**
 * Gracefully stop the tunnel process.
 */
export function stopTunnel(child: ChildProcess): void {
  if (!child.killed) {
    child.kill('SIGTERM')
  }
}
