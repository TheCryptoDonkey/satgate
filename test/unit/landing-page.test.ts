import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('../../src/page/index.html', import.meta.url)), 'utf8')

describe('landing page', () => {
  it('takes the free allowance from the server rather than a fixed figure', () => {
    expect(html).not.toMatch(/FREE_TOKEN_BUDGET = [1-9]/)
    expect(html).not.toMatch(/free tokens to start/)
    expect(html).toContain('freeTier.credits_per_day')
  })

  it('does not describe IETF Payment as a way to pay', () => {
    expect(html).not.toMatch(/Pay with Lightning or IETF Payment/)
  })

  it('only asks for a large card image when it provides one', () => {
    const large = /twitter:card" content="summary_large_image"/.test(html)
    const image = /property="og:image"/.test(html)
    expect(large && !image).toBe(false)
  })
})
