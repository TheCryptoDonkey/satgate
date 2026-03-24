import type { PaymentEvent, RequestEvent, ChallengeEvent } from '@forgesworn/toll-booth'

export interface Logger {
  challenge(event: ChallengeEvent): void
  payment(event: PaymentEvent): void
  request(event: RequestEvent): void
  error(message: string, context?: Record<string, unknown>): void
  info(message: string): void
  warn(message: string): void
}

export function createNoopLogger(): Logger {
  return {
    challenge() {},
    payment() {},
    request() {},
    error() {},
    info() {},
    warn() {},
  }
}

export interface LoggerOptions {
  format: 'pretty' | 'json'
  verbose: boolean
}

function sanitiseValue(v: unknown, depth: number): unknown {
  if (depth > 10) return v
  if (typeof v === 'string') return sanitiseLogValue(v)
  if (Array.isArray(v)) return v.map(item => sanitiseValue(item, depth + 1))
  if (typeof v === 'object' && v !== null) return sanitiseRecord(v as Record<string, unknown>, depth + 1)
  return v
}

function sanitiseRecord(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitiseValue(v, depth)
  }
  return out
}

function jsonLine(obj: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(obj) + '\n')
}

function createJsonLogger(): Logger {
  return {
    payment(event) {
      jsonLine({ ...sanitiseRecord(event as unknown as Record<string, unknown>), ts: event.timestamp, level: 'info', event: 'payment' })
    },
    request(event) {
      jsonLine({ ...sanitiseRecord(event as unknown as Record<string, unknown>), ts: event.timestamp, level: 'info', event: 'request' })
    },
    challenge(event) {
      jsonLine({ ...sanitiseRecord(event as unknown as Record<string, unknown>), ts: event.timestamp, level: 'info', event: 'challenge' })
    },
    error(message, context) {
      jsonLine({ ...(context ? sanitiseRecord(context) : {}), ts: new Date().toISOString(), level: 'error', event: 'error', message: sanitiseLogValue(message) })
    },
    info(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'info', event: 'info', message: sanitiseLogValue(message) })
    },
    warn(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'warn', event: 'warn', message: sanitiseLogValue(message) })
    },
  }
}

// ANSI colour helpers
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const WHITE = '\x1b[37m'

function truncHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash
}

/** Strip control characters (CR, LF, ANSI escapes) from user-controlled strings to prevent log injection. */
function sanitiseLogValue(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

function createPrettyLogger(verbose: boolean): Logger {
  function write(line: string): void {
    process.stderr.write(line + '\n')
  }

  return {
    payment(event) {
      let line = `${GREEN}⚡ PAID      ${event.amountSats} sats (hash=${truncHash(event.paymentHash)})${RESET}`
      if (verbose) {
        const extras: string[] = []
        if (event.rail) extras.push(`rail=${event.rail}`)
        if (event.currency && event.currency !== 'sat') extras.push(`currency=${event.currency}`)
        if (extras.length > 0) line += ` ${DIM}${extras.join(' ')}${RESET}`
      }
      write(line)
    },

    request(event) {
      const satLabel = event.satsDeducted === 1 ? '1 sat' : `${event.satsDeducted} sats`
      let line = `${DIM}→ REQUEST   ${sanitiseLogValue(event.endpoint)} ${event.latencyMs}ms ${satLabel} deducted (${event.remainingBalance} remaining)${RESET}`
      if (verbose) {
        const extras: string[] = [`authenticated=${event.authenticated}`]
        if (extras.length > 0) line += ` ${extras.join(' ')}`
      }
      write(line)
    },

    challenge(event) {
      write(`${CYAN}🔒 CHALLENGE ${sanitiseLogValue(event.endpoint)} → 402 (${event.amountSats} sats)${RESET}`)
    },

    error(message, context) {
      let line = `${RED}⚠ ERROR     ${sanitiseLogValue(message)}${RESET}`
      if (context) {
        const extras = Object.entries(context).map(([k, v]) => `${k}=${sanitiseLogValue(String(v))}`).join(' ')
        line += ` ${DIM}${extras}${RESET}`
      }
      write(line)
    },

    info(message) {
      write(`${WHITE}ℹ INFO      ${sanitiseLogValue(message)}${RESET}`)
    },

    warn(message) {
      write(`${YELLOW}⚠ WARN      ${sanitiseLogValue(message)}${RESET}`)
    },
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  if (opts.format === 'json') return createJsonLogger()
  return createPrettyLogger(opts.verbose)
}
