import { describe, it, expect } from 'vitest'
import { memoryStorage } from '@forgesworn/toll-booth'
import { creditHold, fixedHold, usdHold } from './hold.js'

const hash = 'c'.repeat(64)

describe('creditHold', () => {
  it('grows by debiting the balance and refunds the excess on settle', () => {
    const storage = memoryStorage()
    storage.credit(hash, 100)
    storage.debit(hash, 10) // taken by toll-booth before the proxy runs
    const hold = creditHold(storage, hash, 10)
    expect(hold.reserve(50)).toBe(true)
    expect(storage.balance(hash)).toBe(50)
    hold.settle(7)
    expect(storage.balance(hash)).toBe(93)
  })

  it('refuses to grow past the balance and leaves it untouched', () => {
    const storage = memoryStorage()
    storage.credit(hash, 20)
    storage.debit(hash, 10)
    const hold = creditHold(storage, hash, 10)
    expect(hold.reserve(30)).toBe(false)
    expect(storage.balance(hash)).toBe(10)
    hold.settle(0)
    expect(storage.balance(hash)).toBe(20)
  })

  it('only settles once', () => {
    const storage = memoryStorage()
    storage.credit(hash, 10)
    storage.debit(hash, 10)
    const hold = creditHold(storage, hash, 10)
    hold.settle(0)
    hold.settle(0)
    expect(storage.balance(hash)).toBe(10)
  })
})

describe('fixedHold', () => {
  it('caps the request at what was paid', () => {
    const hold = fixedHold(5)
    expect(hold.ceiling).toBe(5)
    expect(hold.reserve(5)).toBe(true)
    expect(hold.reserve(6)).toBe(false)
  })
})

describe('usdHold', () => {
  it('refunds a credit hold only when nothing was served', () => {
    const storage = memoryStorage()
    storage.credit(hash, 100, 'usd')
    storage.debit(hash, 5, 'usd')
    usdHold(storage, hash, 5, true).settle(3)
    expect(storage.balance(hash, 'usd')).toBe(95)
    usdHold(storage, hash, 5, true).settle(0)
    expect(storage.balance(hash, 'usd')).toBe(100)
  })
})
