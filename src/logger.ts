import type { PaymentEvent, RequestEvent, ChallengeEvent } from '@thecryptodonkey/toll-booth'

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

function jsonLine(obj: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(obj) + '\n')
}

function createJsonLogger(): Logger {
  return {
    payment(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'payment', ...event })
    },
    request(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'request', ...event })
    },
    challenge(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'challenge', ...event })
    },
    error(message, context) {
      jsonLine({ ts: new Date().toISOString(), level: 'error', event: 'error', message, ...context })
    },
    info(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'info', event: 'info', message })
    },
    warn(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'warn', event: 'warn', message })
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
      let line = `${DIM}→ REQUEST   ${event.endpoint} ${event.latencyMs}ms ${satLabel} deducted (${event.remainingBalance} remaining)${RESET}`
      if (verbose) {
        const extras: string[] = [`authenticated=${event.authenticated}`]
        if (extras.length > 0) line += ` ${extras.join(' ')}`
      }
      write(line)
    },

    challenge(event) {
      write(`${CYAN}🔒 CHALLENGE ${event.endpoint} → 402 (${event.amountSats} sats)${RESET}`)
    },

    error(message, context) {
      let line = `${RED}⚠ ERROR     ${message}${RESET}`
      if (context) {
        const extras = Object.entries(context).map(([k, v]) => `${k}=${v}`).join(' ')
        line += ` ${DIM}${extras}${RESET}`
      }
      write(line)
    },

    info(message) {
      write(`${WHITE}ℹ INFO      ${message}${RESET}`)
    },

    warn(message) {
      write(`${YELLOW}⚠ WARN      ${message}${RESET}`)
    },
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  if (opts.format === 'json') return createJsonLogger()
  return createPrettyLogger(opts.verbose)
}
