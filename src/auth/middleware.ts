import type { Context, MiddlewareHandler } from 'hono'
import { checkAllowlist } from './allowlist.js'

export interface AuthMiddlewareConfig {
  authMode: 'open' | 'lightning' | 'cashu' | 'allowlist'
  allowlist: string[]
  /** The service's public base URL, e.g. https://ai.example.com. */
  publicUrl?: string
  /** Trust X-Forwarded-Proto / X-Forwarded-Host from a reverse proxy. */
  trustProxy?: boolean
}

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/

/**
 * The URLs a client may have signed for this request. Behind a TLS proxy
 * the server sees http://127.0.0.1:3000/..., while the client signed
 * https://public.host/..., so the public form is rebuilt from the
 * configured public URL, or from forwarded headers when they are trusted.
 */
export function publicRequestUrls(c: Context, config: Pick<AuthMiddlewareConfig, 'publicUrl' | 'trustProxy'>): string[] {
  const urls: string[] = []
  const raw = new URL(c.req.url)
  const pathAndQuery = raw.pathname + raw.search
  if (config.publicUrl) {
    try {
      const base = new URL(config.publicUrl)
      urls.push(`${base.origin}${base.pathname.replace(/\/+$/, '')}${pathAndQuery}`)
    } catch { /* invalid public URL: ignore */ }
  }
  if (config.trustProxy) {
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    const host = (c.req.header('x-forwarded-host') ?? c.req.header('host'))?.split(',')[0]?.trim()
    if ((proto === 'http' || proto === 'https') && host && HOST_RE.test(host)) {
      urls.push(`${proto}://${host}${pathAndQuery}`)
    }
  }
  return urls
}

/**
 * Creates Hono middleware that handles auth based on the configured mode.
 *
 * - open: pass through (no checks)
 * - allowlist: check Authorization header against allowlist
 * - lightning: pass through — toll-booth's authMiddleware is mounted separately
 *   in server.ts for the lightning path
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig): MiddlewareHandler {
  if (config.authMode === 'allowlist') {
    return async (c, next) => {
      const authHeader = c.req.header('Authorization')
      const requestUrl = c.req.url
      const requestMethod = c.req.method
      const result = checkAllowlist(authHeader, config.allowlist, {
        url: requestUrl,
        method: requestMethod,
        alternateUrls: publicRequestUrls(c, config),
      })
      if (!result.allowed) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      await next()
    }
  }

  // open mode and lightning mode: pass through
  return async (_c, next) => { await next() }
}
