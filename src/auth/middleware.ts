import type { MiddlewareHandler } from 'hono'
import { checkAllowlist } from './allowlist.js'

export interface AuthMiddlewareConfig {
  authMode: 'open' | 'lightning' | 'allowlist'
  allowlist: string[]
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
