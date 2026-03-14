import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, createNoopLogger } from './logger.js'
import type { PaymentEvent, RequestEvent, ChallengeEvent } from '@thecryptodonkey/toll-booth'

const samplePayment: PaymentEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  paymentHash: 'ab'.repeat(32),
  amountSats: 21,
  rail: 'l402',
}

const sampleRequest: RequestEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  endpoint: '/v1/chat/completions',
  satsDeducted: 1,
  remainingBalance: 79,
  latencyMs: 347,
  authenticated: true,
}

const sampleChallenge: ChallengeEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  endpoint: '/v1/chat/completions',
  amountSats: 100,
}

describe('Logger', () => {
  describe('createNoopLogger', () => {
    it('does not throw on any method', () => {
      const logger = createNoopLogger()
      expect(() => logger.payment(samplePayment)).not.toThrow()
      expect(() => logger.request(sampleRequest)).not.toThrow()
      expect(() => logger.challenge(sampleChallenge)).not.toThrow()
      expect(() => logger.error('test')).not.toThrow()
      expect(() => logger.info('test')).not.toThrow()
      expect(() => logger.warn('test')).not.toThrow()
    })

    it('does not write to stderr', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const logger = createNoopLogger()
      logger.payment(samplePayment)
      logger.request(sampleRequest)
      logger.info('test')
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('createLogger (json)', () => {
    let output: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let writeSpy: any

    beforeEach(() => {
      output = []
      writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        output.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it('emits payment as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.payment(samplePayment)
      expect(output).toHaveLength(1)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('payment')
      expect(parsed.amountSats).toBe(21)
      expect(parsed.paymentHash).toBe('ab'.repeat(32))
      expect(parsed.rail).toBe('l402')
      expect(parsed.level).toBe('info')
      expect(parsed.ts).toBeDefined()
    })

    it('emits request as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.request(sampleRequest)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('request')
      expect(parsed.endpoint).toBe('/v1/chat/completions')
      expect(parsed.satsDeducted).toBe(1)
      expect(parsed.remainingBalance).toBe(79)
      expect(parsed.latencyMs).toBe(347)
    })

    it('emits challenge as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.challenge(sampleChallenge)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('challenge')
      expect(parsed.amountSats).toBe(100)
    })

    it('emits error as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.error('upstream timeout', { endpoint: '/v1/chat/completions', latencyMs: 5003 })
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('error')
      expect(parsed.level).toBe('error')
      expect(parsed.message).toBe('upstream timeout')
      expect(parsed.endpoint).toBe('/v1/chat/completions')
    })

    it('emits info as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.info('server started')
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('info')
      expect(parsed.message).toBe('server started')
    })

    it('emits warn as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.warn('high load')
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('warn')
      expect(parsed.level).toBe('warn')
      expect(parsed.message).toBe('high load')
    })
  })

  describe('createLogger (pretty)', () => {
    let output: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let writeSpy: any

    beforeEach(() => {
      output = []
      writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        output.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    // Strip ANSI codes for assertion
    function strip(s: string): string {
      return s.replace(/\x1b\[[0-9;]*m/g, '')
    }

    it('formats payment with amount and hash', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.payment(samplePayment)
      expect(output).toHaveLength(1)
      const line = strip(output[0])
      expect(line).toContain('PAID')
      expect(line).toContain('21 sats')
    })

    it('formats request with endpoint, latency, and deduction', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.request(sampleRequest)
      const line = strip(output[0])
      expect(line).toContain('REQUEST')
      expect(line).toContain('/v1/chat/completions')
      expect(line).toContain('347ms')
      expect(line).toContain('1 sat')
      expect(line).toContain('79 remaining')
    })

    it('formats challenge with endpoint and amount', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.challenge(sampleChallenge)
      const line = strip(output[0])
      expect(line).toContain('CHALLENGE')
      expect(line).toContain('/v1/chat/completions')
      expect(line).toContain('100 sats')
    })

    it('formats error with message', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.error('upstream timeout', { endpoint: '/v1/chat/completions' })
      const line = strip(output[0])
      expect(line).toContain('ERROR')
      expect(line).toContain('upstream timeout')
    })

    it('formats info message', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.info('server started')
      const line = strip(output[0])
      expect(line).toContain('INFO')
      expect(line).toContain('server started')
    })

    it('includes extra fields in verbose mode', () => {
      const logger = createLogger({ format: 'pretty', verbose: true })
      logger.payment(samplePayment)
      const line = strip(output[0])
      expect(line).toContain('rail=l402')
    })

    it('omits extra fields in non-verbose mode', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.payment(samplePayment)
      const line = strip(output[0])
      expect(line).not.toContain('rail=')
    })
  })
})
