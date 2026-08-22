import { describe, it, expect, afterEach } from 'vitest'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createMoneyer, createFakeBackend, fakeBolt11, type Moneyer, type FakeBackend } from '@forgesworn/moneyer'
import { buildNoteUrl, fetchNoteInfo, fetchPayRequest, requestInvoice } from 'lnurlcash-kit'
import { decodeBolt11 } from 'farrier-kit/bolt11'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { createTokenTollServer } from './server.js'

// A paywall paid with a bearer note, against a real mint.
//
// The rail settles a note with one rotate, which is what proves it live and
// takes it off the payer. What satgate adds is the far end: the note this
// booth now owns is money at somebody else's mint, and an operator with a
// node would rather have it at their own. This is that whole path - 402,
// note, completion, melt - with nothing mocked but the Lightning node.

let mint: { moneyer: Moneyer; backend: FakeBackend } | null = null
let upstream: ReturnType<typeof serve> | null = null

const startMint = async () => {
  const backend = createFakeBackend()
  const moneyer = await createMoneyer(
    {
      host: '127.0.0.1',
      port: 0,
      username: 'mint',
      description: 'an LNURLcash note',
      minSendableMsat: 1000,
      maxSendableMsat: 100_000_000,
      minMintMsat: 1000,
      mintFee: null,
      signingKey: bytesToHex(randomBytes(32)),
      dbPath: ':memory:',
      backend: { kind: 'fake' },
      verify: true,
      maxK1s: 21,
      sunset: false,
    },
    { backend, confirmDelaysMs: [0, 10] },
  )
  mint = { moneyer, backend }
  return mint
}

const startUpstream = async (): Promise<string> => {
  const app = new Hono()
  app.post('/v1/chat/completions', (c) =>
    c.json({
      choices: [{ message: { role: 'assistant', content: 'Paid for with a note.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  )
  app.get('/v1/models', (c) => c.json({ data: [{ id: 'llama3', object: 'model' }] }))
  return new Promise((resolve) => {
    upstream = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(`http://localhost:${info.port}`))
  })
}

afterEach(async () => {
  await mint?.moneyer.close()
  mint = null
  upstream?.close()
  upstream = null
})

/** Buys a note at the mint the way any wallet does: pay, then hold the preimage. */
const buyNote = async (amountMsat: number): Promise<string> => {
  const { moneyer, backend } = mint!
  const pay = await fetchPayRequest(`${moneyer.url}/.well-known/lnurlp/mint`)
  const invoice = await requestInvoice(pay.callback, amountMsat)
  const paymentHash = decodeBolt11(invoice.pr)!.paymentHashHex
  backend.control.settleInvoice(paymentHash)
  const preimage = backend.control.invoiceByHash(paymentHash)!.preimageHex
  return buildNoteUrl(`${moneyer.url}/w`, preimage)
}

/**
 * A node that issues invoices and remembers what it was asked for. The
 * description matters: an L402 challenge asks this same node for invoices
 * too, so a test that only counted amounts would be reading the paywall's
 * own quotes as if they were the sweep.
 */
const recordingBackend = () => {
  const invoiced: Array<{ amountSats: number; description?: string }> = []
  const melts = (): number[] =>
    invoiced.filter(i => i.description?.includes('lnurlcash melt')).map(i => i.amountSats)
  return {
    invoiced,
    melts,
    backend: {
      createInvoice: async (amountSats: number, description?: string) => {
        invoiced.push({ amountSats, ...(description === undefined ? {} : { description }) })
        const preimage = bytesToHex(randomBytes(32))
        const paymentHash = bytesToHex(sha256(hexToBytes(preimage)))
        return {
          bolt11: fakeBolt11({ amountMsat: amountSats * 1000, paymentHashHex: paymentHash }),
          paymentHash,
        }
      },
      checkInvoice: async () => ({ paid: false }),
    },
  }
}

const baseConfig = (upstreamUrl: string, host: string) =>
  ({
    upstream: upstreamUrl,
    port: 0,
    rootKey: 'a'.repeat(64),
    rootKeyGenerated: false,
    storage: 'memory' as const,
    dbPath: '',
    pricing: { default: 1, models: {} },
    freeTier: { creditsPerDay: 0 },
    capacity: { maxConcurrent: 0 },
    tiers: [],
    trustProxy: false,
    estimatedCostSats: 10,
    maxBodySize: 10 * 1024 * 1024,
    authMode: 'lightning' as const,
    allowlist: [],
    flatPricing: true,
    price: 10,
    tunnel: false,
    lnurlcash: { mints: [host] },
  })

const ask = (app: { request: (path: string, init?: RequestInit) => Promise<Response> }, headers: Record<string, string> = {}) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hello' }] }),
  })

const until = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('paying satgate with a bearer note', () => {
  it('challenges for one, takes it, and sweeps it to the operator node', async () => {
    const { moneyer } = await startMint()
    const upstreamUrl = await startUpstream()
    const host = new URL(moneyer.url).host
    const node = recordingBackend()

    const { app } = createTokenTollServer({ ...baseConfig(upstreamUrl, host), backend: node.backend })

    // The challenge says what to pay and which mints are accepted.
    const challenged = await ask(app)
    expect(challenged.status).toBe(402)
    const header = challenged.headers.get('x-lnurlcash')
    expect(header).toMatch(/^lnurlcashreq1/)
    const request = JSON.parse(Buffer.from(header!.slice('lnurlcashreq1'.length), 'base64url').toString())
    expect(request.amount).toBe('10')
    expect(request.methodDetails.mints).toEqual([host])

    const note = await buyNote(50_000)
    const paid = await ask(app, { 'X-LNURLcash': note })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({
      choices: [{ message: { content: 'Paid for with a note.' } }],
    })

    // The presented secret is dead: the rotate burned it, so the payer
    // cannot spend it again anywhere.
    await expect(fetchNoteInfo(note)).rejects.toThrow()

    // And the note the booth now owns has been melted to the operator's
    // node, for the whole of what it was worth.
    await until(() => node.melts().length > 0)
    expect(node.melts()).toEqual([50])
  })

  it('refuses a note from a mint it was not told to accept', async () => {
    const { moneyer } = await startMint()
    const upstreamUrl = await startUpstream()
    const node = recordingBackend()

    const { app } = createTokenTollServer({
      ...baseConfig(upstreamUrl, 'somewhere.else.example'),
      backend: node.backend,
    })

    const note = await buyNote(50_000)
    expect((await ask(app, { 'X-LNURLcash': note })).status).toBe(402)
    // Refused before any network call, so the note is untouched and the
    // server was never made to fetch a URL it did not choose.
    expect((await fetchNoteInfo(note)).maxWithdrawable).toBe(50_000)
    expect(node.melts()).toEqual([])
    expect(new URL(moneyer.url).host).not.toBe('somewhere.else.example')
  })

  it('refuses a note worth less than the charge', async () => {
    const { moneyer } = await startMint()
    const upstreamUrl = await startUpstream()
    const node = recordingBackend()

    const { app } = createTokenTollServer({
      ...baseConfig(upstreamUrl, new URL(moneyer.url).host),
      backend: node.backend,
    })

    const note = await buyNote(5_000)
    expect((await ask(app, { 'X-LNURLcash': note })).status).toBe(402)
    // Still spendable: a note that cannot cover the charge is not taken.
    expect((await fetchNoteInfo(note)).maxWithdrawable).toBe(5_000)
  })

  it('takes the note even with no node to sweep it to', async () => {
    const { moneyer } = await startMint()
    const upstreamUrl = await startUpstream()

    // No Lightning backend: the CLI warns that notes cannot be melted, and
    // the payment still has to work - the operator was told, and chose.
    const { app } = createTokenTollServer(baseConfig(upstreamUrl, new URL(moneyer.url).host))

    const note = await buyNote(50_000)
    expect((await ask(app, { 'X-LNURLcash': note })).status).toBe(200)
  })

  it('announces lnurlcash as a payment method', async () => {
    const { moneyer } = await startMint()
    const upstreamUrl = await startUpstream()
    const { app } = createTokenTollServer(baseConfig(upstreamUrl, new URL(moneyer.url).host))

    const wellKnown = await (await app.request('/.well-known/l402')).json()
    expect(wellKnown.payment.methods).toContain('lnurlcash')
    // And which mints, so a caller need not provoke a 402 to find out.
    expect(wellKnown.payment.lnurlcash).toEqual({ mints: [new URL(moneyer.url).host], unit: 'sat' })
  })
})
