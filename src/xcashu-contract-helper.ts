/**
 * Minimal NUT-18 parser — duplicated from 402-mcp's src/xcashu/parse.ts
 * for contract testing only. Production parsing lives in 402-mcp.
 */

export interface XCashuChallenge {
  amount: number
  unit: 'sat'
  mints: string[]
}

export function isXCashuChallenge(headers: Headers): boolean {
  const value = headers.get('x-cashu')
  return !!value && value.startsWith('creqA')
}

export function parseXCashuChallenge(header: string): XCashuChallenge | null {
  if (!header.startsWith('creqA')) return null
  try {
    const b64 = header.slice(5)
    const json = Buffer.from(b64, 'base64url').toString('utf-8')
    const data = JSON.parse(json) as Record<string, unknown>
    const amount = typeof data.a === 'number' && data.a > 0 ? data.a : null
    const unit = data.u
    const mints = Array.isArray(data.m) ? data.m.filter((m): m is string => typeof m === 'string') : null
    if (amount === null || unit !== 'sat' || !mints || mints.length === 0) return null
    return { amount, unit: 'sat', mints }
  } catch { return null }
}
