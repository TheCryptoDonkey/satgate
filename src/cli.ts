import { readFileSync, existsSync } from 'node:fs'
import yaml from 'js-yaml'
import { serve } from '@hono/node-server'
import { loadConfig, type CliArgs } from './config.js'
import { createTokenTollServer } from './server.js'
import { createLightningBackend } from './lightning.js'
import { startTunnel, stopTunnel, type TunnelResult } from './tunnel.js'
import { createLogger } from './logger.js'
import { resolveModelPrice } from './proxy/pricing.js'

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--upstream': args.upstream = argv[++i]; break
      case '--port': args.port = parseInt(argv[++i], 10); break
      case '--config': args.config = argv[++i]; break
      case '--price': args.price = parseInt(argv[++i], 10); break
      case '--max-concurrent': args.maxConcurrent = parseInt(argv[++i], 10); break
      case '--storage': args.storage = argv[++i]; break
      case '--db-path': args.dbPath = argv[++i]; break
      case '--free-tier': args.freeTier = parseInt(argv[++i], 10); break
      case '--trust-proxy': args.trustProxy = true; break
      case '--lightning': args.lightning = argv[++i]; break
      case '--lightning-url': args.lightningUrl = argv[++i]; break
      case '--lightning-key': args.lightningKey = argv[++i]; break
      case '--auth': args.authMode = argv[++i]; break
      case '--allowlist': args.allowlist = argv[++i].split(','); break
      case '--allowlist-file': args.allowlistFile = argv[++i]; break
      case '--no-tunnel': args.noTunnel = true; break
      case '--root-key': args.rootKey = argv[++i]; break
      case '--verbose': args.verbose = true; break
      case '--log-format': args.logFormat = argv[++i]; break
      case '--token-price': args.tokenPrice = parseInt(argv[++i], 10); break
      case '--model-price':
        args.modelPrice = [...(args.modelPrice ?? []), argv[++i]]
        break
      case '--announce': args.announce = true; break
      case '--announce-relays': args.announceRelays = argv[++i]; break
      case '--announce-key': args.announceKey = argv[++i]; break
      case '-h': case '--help': printHelp(); process.exit(0);
      case '-v': case '--version': printVersion(); process.exit(0);
      default:
        console.error(`Unknown option: ${argv[i]}`)
        process.exit(1)
    }
  }
  return args
}

function loadFileConfig(path?: string): Record<string, unknown> {
  const configPath = path
    ?? (existsSync('satgate.json') ? 'satgate.json' : undefined)
    ?? (existsSync('satgate.yaml') ? 'satgate.yaml' : undefined)
  if (!configPath) return {}
  try {
    const content = readFileSync(configPath, 'utf-8')
    if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
      return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
    }
    return JSON.parse(content)
  } catch {
    console.warn(`[satgate] Could not read config file: ${configPath}`)
    return {}
  }
}

function printHelp(): void {
  console.log(`
  satgate - Lightning-paid AI inference

  Usage: satgate [options]

  Upstream:
    --upstream <url>           Upstream API URL (default: auto-detect Ollama on :11434)

  Lightning:
    --lightning <backend>      phoenixd | lnbits | lnd | cln
    --lightning-url <url>      Backend URL (defaults per backend)
    --lightning-key <secret>   Password / API key / macaroon / rune

  Auth:
    --auth <mode>              open | lightning | allowlist (inferred from context)
    --allowlist <keys>         Comma-separated npubs or shared secrets
    --allowlist-file <path>    File with one key per line

  Pricing:
    --price <sats>             Sats per request (flat pricing)
    --token-price <sats>       Sats per 1k tokens (per-token pricing)
    --model-price <model:sats> Per-model token price (repeatable)

  Server:
    --port <number>            Listen port (default: 3000)
    --no-tunnel                Skip Cloudflare Tunnel

  Announce:
    --announce                 Publish service on Nostr relays for discovery
    --announce-relays <urls>   Comma-separated relay URLs (wss://...)
    --announce-key <hex>       Nostr secret key for signing (auto-generated if omitted)

  Storage:
    --storage <type>           memory | sqlite (default: memory)
    --db-path <path>           SQLite path (default: ./satgate.db)

  Other:
    --config <path>            Config file (JSON or YAML)
    --max-concurrent <n>       Max concurrent inference requests
    --free-tier <n>            Free credits (sats) per IP per day (default: 0)
    --trust-proxy              Trust X-Forwarded-For headers
    --root-key <key>           Root key for macaroon minting
    --verbose                  Show extra fields in log output
    --log-format <format>      pretty | json (default: pretty)
    -h, --help                 Show help
    -v, --version              Show version
`)
}

function printVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    console.log(`satgate v${pkg.version}`)
  } catch {
    console.log('satgate (unknown version)')
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = parseArgs(argv)
  const fileConfig = loadFileConfig(args.config)

  // Auto-detect Ollama if no upstream specified
  let ollamaAutoDetected = false
  if (!args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream) {
    try {
      const res = await fetch('http://localhost:11434/v1/models', {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) {
        args.upstream = 'http://localhost:11434'
        ollamaAutoDetected = true
        console.log('[satgate] Ollama detected on :11434')
      }
    } catch {
      // Ollama not found
    }

    if (!args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream) {
      console.error('[satgate] No upstream detected. Ollama not found on :11434.')
      console.error('[satgate] Either start Ollama or pass --upstream <url>')
      process.exit(1)
    }
  }

  // Load allowlist file before config validation so --allowlist-file works standalone
  if (args.allowlistFile) {
    const { resolve, relative } = await import('node:path')
    const { realpathSync } = await import('node:fs')
    let resolvedAllowlistPath: string
    try {
      resolvedAllowlistPath = realpathSync(resolve(args.allowlistFile))
    } catch {
      console.error(`[satgate] Could not read allowlist file: ${args.allowlistFile}`)
      process.exit(1)
    }
    const relFromCwd = relative(process.cwd(), resolvedAllowlistPath)
    if (relFromCwd.startsWith('..')) {
      console.error(`[satgate] --allowlist-file must be within the working directory (got: ${args.allowlistFile})`)
      process.exit(1)
    }
    let content: string
    try {
      content = readFileSync(resolvedAllowlistPath, 'utf-8')
    } catch {
      console.error(`[satgate] Could not read allowlist file: ${args.allowlistFile}`)
      process.exit(1)
    }
    const entries = content.split('\n').map(l => l.trim()).filter(Boolean)
    args.allowlist = [...(args.allowlist ?? []), ...entries]
  }

  // Warn when secrets are passed on the command line (visible in `ps aux`)
  const cliSecrets: string[] = []
  if (args.lightningKey) cliSecrets.push('--lightning-key')
  if (args.rootKey) cliSecrets.push('--root-key')
  if (args.announceKey) cliSecrets.push('--announce-key')
  if (cliSecrets.length > 0) {
    console.warn(`[satgate] WARNING: ${cliSecrets.join(', ')} passed on command line — visible to other users via \`ps\`.`)
    console.warn('[satgate] Use environment variables (LIGHTNING_KEY, ROOT_KEY, ANNOUNCE_KEY) instead.')
  }

  const config = loadConfig(args, process.env as Record<string, string>, fileConfig)
  const logger = createLogger({ format: config.logFormat, verbose: config.verbose })

  if (config.flatPricing && config.price === 0) {
    logger.warn('Flat price is 0 sats — all inference is free')
  }

  // Auto-detect models from upstream (retry to handle startup races with Ollama)
  let models: string[] = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${config.upstream}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      })
      const body = await res.json() as { data?: Array<{ id: string }> }
      models = body.data?.map(m => m.id) ?? []
      if (models.length > 0) break
    } catch {
      // Fall through to retry
    }
    if (attempt < 3) {
      console.warn(`[satgate] Upstream not ready, retrying model detection (${attempt}/3)...`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  if (models.length === 0) {
    console.warn('[satgate] Could not auto-detect models from upstream')
  }

  const backend = createLightningBackend(config)
  const { app } = createTokenTollServer({ ...config, models, backend, logger })

  let version = '0.1.0'
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    version = pkg.version
  } catch { /* ignore */ }

  let tunnelResult: TunnelResult | undefined
  let announcement: { close(): void; pubkey: string } | undefined

  const server = serve({ fetch: app.fetch, port: config.port }, async () => {
    const lightningLabel = config.lightning
      ? `${config.lightning} (${config.lightningUrl})`
      : 'none (free mode)'
    const authLabel = config.authMode === 'lightning'
      ? 'lightning (pay-per-request)'
      : config.authMode === 'allowlist'
        ? `allowlist (${config.allowlist.length} identities)`
        : 'open'
    const priceLabel = config.flatPricing
      ? `${config.price} sat/request`
      : `${config.pricing.default} sat/1k tokens`

    logger.info(`satgate v${version}`)
    logger.info(`Upstream:   ${config.upstream}${ollamaAutoDetected ? ' (auto-detected)' : ''}`)
    logger.info(`Models:     ${models.length > 0 ? models.join(', ') : '(none detected)'}`)
    logger.info(`Lightning:  ${lightningLabel}`)
    logger.info(`Auth:       ${authLabel}`)
    logger.info(`Price:      ${priceLabel}`)
    logger.info(`Storage:    ${config.storage}${config.storage === 'memory' ? ' (ephemeral)' : ''}`)
    logger.info(`Local:      http://localhost:${config.port}`)
    if (config.rootKeyGenerated) {
      logger.warn('Using auto-generated root key (not persisted across restarts)')
      logger.warn('Set ROOT_KEY env var for production use')
    }
    logger.info('/.well-known/l402  |  /llms.txt  |  /health')

    if (config.authMode === 'open' && config.tunnel) {
      logger.warn('Server is publicly tunnelled with NO authentication.')
      logger.warn('Configure --lightning or --auth allowlist for production use.')
    }

    // Start tunnel if enabled
    if (config.tunnel) {
      tunnelResult = await startTunnel(config.port)
      if (tunnelResult.url) {
        logger.info(`Public:     ${tunnelResult.url}`)
      } else if (tunnelResult.error) {
        logger.warn(`Tunnel:     ${tunnelResult.error}`)
      }
    } else {
      logger.info('Tunnel:     disabled')
    }

    // Announce on Nostr relays
    if (config.announce) {
      if (config.announceRelays.length === 0) {
        logger.warn('--announce enabled but no --announce-relays provided')
      } else {
        const publicUrl = tunnelResult?.url ?? `http://localhost:${config.port}`

        const { announceService } = await import('402-announce')
        const { randomBytes } = await import('node:crypto')

        const announceKey = config.announceKey || randomBytes(32).toString('hex')
        if (!config.announceKey) {
          const { mkdirSync, writeFileSync } = await import('node:fs')
          const { join } = await import('node:path')
          const { homedir } = await import('node:os')

          const keyDir = join(homedir(), '.satgate')
          const keyPath = join(keyDir, 'announce.key')
          mkdirSync(keyDir, { recursive: true, mode: 0o700 })
          writeFileSync(keyPath, announceKey, { mode: 0o600 })
          logger.info(`Announce key saved to ${keyPath} (chmod 600)`)
        }

        const paymentMethods = ['bitcoin-lightning-bolt11']

        try {
          announcement = await announceService({
            secretKey: announceKey,
            relays: config.announceRelays,
            identifier: `satgate-${new URL(publicUrl).hostname}`,
            name: `satgate @ ${publicUrl}`,
            url: publicUrl,
            about: `Pay-per-token AI inference — ${models.join(', ')}`,
            pricing: models.map(m => ({
              capability: m,
              price: resolveModelPrice(config.pricing, m),
              currency: 'sats',
            })),
            paymentMethods,
            topics: ['ai', 'inference', 'llm', 'openai-compatible'],
            capabilities: models.map(m => ({
              name: m,
              description: `Chat completion with ${m}`,
              schema: {
                type: 'object',
                properties: {
                  model: { type: 'string', enum: [m] },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                        content: { type: 'string' },
                      },
                      required: ['role', 'content'],
                    },
                  },
                },
                required: ['model', 'messages'],
              },
              outputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  choices: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        message: {
                          type: 'object',
                          properties: {
                            role: { type: 'string' },
                            content: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            })),
          })
          logger.info(`Announced on ${config.announceRelays.length} relay(s) as ${announcement!.pubkey}`)
          ;(config as unknown as Record<string, unknown>).announceKey = ''
          delete process.env.ANNOUNCE_KEY
        } catch (err) {
          logger.warn(`Announce failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  })

  const shutdown = () => {
    announcement?.close()
    if (tunnelResult?.process) stopTunnel(tunnelResult.process)
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
