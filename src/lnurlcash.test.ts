import { describe, it, expect, afterEach } from 'vitest'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createMoneyer, createFakeBackend, fakeBolt11 } from '@forgesworn/moneyer'
import { createMoneyer as createLegacyMoneyer, createFakeBackend as createLegacyFakeBackend } from 'moneyer-legacy'
import {
  buildNoteUrl,
  decodeCs1WithAmount,
  encodeCs1WithAmount,
  fetchNoteInfo,
  fetchPayRequest,
  isCs1WithAmount,
  requestInvoice,
} from '@lnurlcash/kit'
import { decodeBolt11 } from 'farrier-kit/bolt11'
import { bech32m } from '@scure/base'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { createTokenTollServer } from './server.js'
import { lookupNoteBySpend, meltNoteToLightning } from './lnurlcash-melt.js'

// A paywall paid with a bearer note, against a real mint.
//
// The rail settles a note with one rotate, which is what proves it live and
// takes it off the payer. What satgate adds is the far end: the note this
// booth now owns is money at somebody else's mint, and an operator with a
// node would rather have it at their own. This is that whole path - 402,
// note, completion, melt - with nothing mocked but the Lightning node.
//
// Two mint generations are graded. The current one speaks LUD-25 as revised
// for unified taproot notes: notes are named by `cp1` and certificates travel
// as `c=cs1<amount>`. The legacy one predates that and reads only `k1` on a
// lookup. A note from either must still melt.

type Generation = 'current' | 'legacy'

interface TestMint {
  generation: Generation
  url: string
  close: () => Promise<void>
  control: {
    settleInvoice(paymentHashHex: string): void
    invoiceByHash(paymentHashHex: string): { preimageHex: string } | undefined
    sentAmountMsat(paymentHashHex: string): number | null | undefined
  }
}

let mint: TestMint | null = null
let upstream: ReturnType<typeof serve> | null = null

const startMint = async (generation: Generation = 'current'): Promise<TestMint> => {
  const config = {
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
    backend: { kind: 'fake' as const },
    verify: true,
    maxK1s: 21,
    sunset: false,
  }
  if (generation === 'current') {
    const backend = createFakeBackend()
    const moneyer = await createMoneyer(config, { backend, confirmDelaysMs: [0, 10] })
    mint = { generation, url: moneyer.url, close: () => moneyer.close(), control: backend.control }
  } else {
    const backend = createLegacyFakeBackend()
    const moneyer = await createLegacyMoneyer(config, { backend, confirmDelaysMs: [0, 10] })
    mint = { generation, url: moneyer.url, close: () => moneyer.close(), control: backend.control }
  }
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
  await mint?.close()
  mint = null
  upstream?.close()
  upstream = null
})

/**
 * Buys a note at the mint the way a wallet of its generation does. A current
 * mint binds the quote to the note it will strike, named in the invoice
 * comment, so the wallet picks its own secret; a legacy mint makes the
 * invoice's preimage the secret.
 */
const buyNote = async (amountMsat: number): Promise<{ url: string; k1: string }> => {
  const { url, control, generation } = mint!
  const pay = await fetchPayRequest(`${url}/.well-known/lnurlp/mint`)
  if (generation === 'current') {
    const k1 = bytesToHex(randomBytes(32))
    const invoice = await requestInvoice(pay.callback, amountMsat, bytesToHex(sha256(hexToBytes(k1))))
    control.settleInvoice(decodeBolt11(invoice.pr)!.paymentHashHex)
    return { url: buildNoteUrl(`${url}/w`, k1), k1 }
  }
  const invoice = await requestInvoice(pay.callback, amountMsat)
  const paymentHash = decodeBolt11(invoice.pr)!.paymentHashHex
  control.settleInvoice(paymentHash)
  const k1 = control.invoiceByHash(paymentHash)!.preimageHex
  return { url: buildNoteUrl(`${url}/w`, k1), k1 }
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

/** Whether the mint still holds the note, asked the way every generation answers. */
const worth = async (note: { url: string; k1: string }): Promise<number> =>
  (await lookupNoteBySpend(note.url, note.k1)).maxWithdrawable

describe.each(['current', 'legacy'] as const)('paying satgate with a bearer note (%s mint)', (generation) => {
  it('challenges for one, takes it, and sweeps it to the operator node', async () => {
    const { url } = await startMint(generation)
    const upstreamUrl = await startUpstream()
    const host = new URL(url).host
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
    const paid = await ask(app, { 'X-LNURLcash': note.url })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({
      choices: [{ message: { content: 'Paid for with a note.' } }],
    })

    // The presented secret is dead: the rotate burned it, so the payer
    // cannot spend it again anywhere.
    await expect(worth(note)).rejects.toThrow()

    // And the note the booth now owns has been melted to the operator's
    // node, for the whole of what it was worth.
    await until(() => node.melts().length > 0)
    expect(node.melts()).toEqual([50])
  })

  it('refuses a note from a mint it was not told to accept', async () => {
    const { url } = await startMint(generation)
    const upstreamUrl = await startUpstream()
    const node = recordingBackend()

    const { app } = createTokenTollServer({
      ...baseConfig(upstreamUrl, 'somewhere.else.example'),
      backend: node.backend,
    })

    const note = await buyNote(50_000)
    expect((await ask(app, { 'X-LNURLcash': note.url })).status).toBe(402)
    // Refused before any network call, so the note is untouched and the
    // server was never made to fetch a URL it did not choose.
    expect(await worth(note)).toBe(50_000)
    expect(node.melts()).toEqual([])
    expect(new URL(url).host).not.toBe('somewhere.else.example')
  })

  it('refuses a note worth less than the charge', async () => {
    const { url } = await startMint(generation)
    const upstreamUrl = await startUpstream()
    const node = recordingBackend()

    const { app } = createTokenTollServer({
      ...baseConfig(upstreamUrl, new URL(url).host),
      backend: node.backend,
    })

    const note = await buyNote(5_000)
    expect((await ask(app, { 'X-LNURLcash': note.url })).status).toBe(402)
    // Still spendable: a note that cannot cover the charge is not taken.
    expect(await worth(note)).toBe(5_000)
  })

  it('takes the note even with no node to sweep it to', async () => {
    const { url } = await startMint(generation)
    const upstreamUrl = await startUpstream()

    // No Lightning backend: the CLI warns that notes cannot be melted, and
    // the payment still has to work - the operator was told, and chose.
    const { app } = createTokenTollServer(baseConfig(upstreamUrl, new URL(url).host))

    const note = await buyNote(50_000)
    expect((await ask(app, { 'X-LNURLcash': note.url })).status).toBe(200)
  })

  it('announces lnurlcash as a payment method', async () => {
    const { url } = await startMint(generation)
    const upstreamUrl = await startUpstream()
    const { app } = createTokenTollServer(baseConfig(upstreamUrl, new URL(url).host))

    const wellKnown = await (await app.request('/.well-known/l402')).json()
    expect(wellKnown.payment.methods).toContain('lnurlcash')
    // And which mints, so a caller need not provoke a 402 to find out.
    expect(wellKnown.payment.lnurlcash).toEqual({ mints: [new URL(url).host], unit: 'sat' })
  })
})

/**
 * The URL shapes a note held by this booth can be in. The certificate is the
 * mint's own where it gives one; the legacy mint issues none on a lookup, so
 * there it is a stand-in of the right shape, which the mint never sees.
 */
const NOTE_SHAPES = ['c=cs1<amount>', 'bare k1', 'k1 with amount', 'sig as hex', 'sig as fixed-HRP cs1'] as const

const noteShapes = async (
  note: { url: string; k1: string },
  amountMsat: number,
): Promise<Record<(typeof NOTE_SHAPES)[number], string>> => {
  const { generation } = mint!
  let signature: Uint8Array
  let c: string
  if (generation === 'current') {
    const lookup = new URL(note.url)
    const answer = await (await fetch(lookup)).json() as { c?: string }
    expect(isCs1WithAmount(answer.c!)).toBe(true)
    c = answer.c!
    signature = decodeCs1WithAmount(c)!.signature
  } else {
    signature = randomBytes(65)
    c = encodeCs1WithAmount(amountMsat, signature)
  }
  const shaped = (params: Record<string, string>) => {
    const url = new URL(note.url)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }
  return {
    // Current LUD-25: the certificate carries the amount in its HRP.
    'c=cs1<amount>': shaped({ c }),
    // Older shapes, from wallets and booths that predate it.
    'bare k1': note.url,
    'k1 with amount': shaped({ amount: String(amountMsat) }),
    'sig as hex': shaped({ amount: String(amountMsat), sig: bytesToHex(signature) }),
    'sig as fixed-HRP cs1': shaped({ amount: String(amountMsat), sig: bech32m.encode('cs', bech32m.toWords(signature), false) }),
  }
}

describe.each(['current', 'legacy'] as const)('melting a held note (%s mint)', (generation) => {
  it.each(NOTE_SHAPES)('melts a note held as %s, for its whole value', async (shape) => {
    await startMint(generation)
    const bought = await buyNote(21_000)
    const url = (await noteShapes(bought, 21_000))[shape]
    const invoices: string[] = []

    const result = await meltNoteToLightning({
      note: { url, k1: bought.k1, amountMsat: 21_000, host: new URL(url).host },
      createInvoice: async (amountSats) => {
        const paymentHashHex = bytesToHex(randomBytes(32))
        invoices.push(paymentHashHex)
        return fakeBolt11({ amountMsat: amountSats * 1000, paymentHashHex })
      },
    })

    expect(result).toMatchObject({ paid: true, amountSats: 21 })
    // The mint paid the operator's invoice (an amount of null is the
    // invoice's own), and the note is gone.
    expect(result.verify).toMatch(new RegExp(`/verify/${invoices[0]}$`))
    await until(() => mint!.control.sentAmountMsat(invoices[0]!) !== undefined)
    await expect(worth(bought)).rejects.toThrow()
  })

  it('reports a note it could not melt rather than claiming it', async () => {
    await startMint(generation)
    const bought = await buyNote(21_000)
    const note = { url: bought.url, k1: bought.k1, amountMsat: 21_000, host: new URL(bought.url).host }
    const createInvoice = async (amountSats: number) =>
      fakeBolt11({ amountMsat: amountSats * 1000, paymentHashHex: bytesToHex(randomBytes(32)) })

    expect((await meltNoteToLightning({ note, createInvoice })).paid).toBe(true)
    const again = await meltNoteToLightning({ note, createInvoice })
    expect(again.paid).toBe(false)
    expect(again.error).toBeTruthy()
  })
})

it("needs the k1 lookup: the kit's own names a note by cp1, which a legacy mint does not read", async () => {
  await startMint('legacy')
  const bought = await buyNote(21_000)
  await expect(fetchNoteInfo(bought.url)).rejects.toThrow()
  expect(await worth(bought)).toBe(21_000)
})
