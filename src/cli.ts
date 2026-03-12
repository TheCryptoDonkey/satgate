import { readFileSync, existsSync } from 'node:fs'
import yaml from 'js-yaml'
import { serve } from '@hono/node-server'
import { loadConfig, type CliArgs } from './config.js'
import { createTokenTollServer } from './server.js'
import { createLightningBackend } from './lightning.js'
import { startTunnel, stopTunnel, type TunnelResult } from './tunnel.js'

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
    ?? (existsSync('token-toll.json') ? 'token-toll.json' : undefined)
    ?? (existsSync('token-toll.yaml') ? 'token-toll.yaml' : undefined)
  if (!configPath) return {}
  try {
    const content = readFileSync(configPath, 'utf-8')
    if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
      return yaml.load(content) as Record<string, unknown>
    }
    return JSON.parse(content)
  } catch {
    console.warn(`[token-toll] Could not read config file: ${configPath}`)
    return {}
  }
}

function printHelp(): void {
  console.log(`
  token-toll - Lightning-paid AI inference

  Usage: token-toll [options]

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
    --price <sats>             Sats per request (default: 1)

  Server:
    --port <number>            Listen port (default: 3000)
    --no-tunnel                Skip Cloudflare Tunnel

  Storage:
    --storage <type>           memory | sqlite (default: memory)
    --db-path <path>           SQLite path (default: ./token-toll.db)

  Other:
    --config <path>            Config file (JSON or YAML)
    --max-concurrent <n>       Max concurrent inference requests
    --free-tier <n>            Free requests per IP per day (default: 0)
    --trust-proxy              Trust X-Forwarded-For headers
    --root-key <key>           Root key for macaroon minting
    -h, --help                 Show help
    -v, --version              Show version
`)
}

function printVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    console.log(`token-toll v${pkg.version}`)
  } catch {
    console.log('token-toll (unknown version)')
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
        console.log('[token-toll] Ollama detected on :11434')
      }
    } catch {
      // Ollama not found
    }

    if (!args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream) {
      console.error('[token-toll] No upstream detected. Ollama not found on :11434.')
      console.error('[token-toll] Either start Ollama or pass --upstream <url>')
      process.exit(1)
    }
  }

  // Load allowlist file before config validation so --allowlist-file works standalone
  if (args.allowlistFile) {
    const content = readFileSync(args.allowlistFile, 'utf-8')
    const entries = content.split('\n').map(l => l.trim()).filter(Boolean)
    args.allowlist = [...(args.allowlist ?? []), ...entries]
  }

  const config = loadConfig(args, process.env as Record<string, string>, fileConfig)

  // Auto-detect models from upstream
  let models: string[] = []
  try {
    const res = await fetch(`${config.upstream}/v1/models`)
    const body = await res.json() as { data?: Array<{ id: string }> }
    models = body.data?.map(m => m.id) ?? []
  } catch {
    console.warn('[token-toll] Could not auto-detect models from upstream')
  }

  const backend = createLightningBackend(config)
  const { app } = createTokenTollServer({ ...config, models, backend })

  let version = '0.1.0'
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    version = pkg.version
  } catch { /* ignore */ }

  let tunnelResult: TunnelResult | undefined

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

    console.log(`
  token-toll v${version}

  Upstream:   ${config.upstream}${ollamaAutoDetected ? ' (auto-detected)' : ''}
  Models:     ${models.length > 0 ? models.join(', ') : '(none detected)'}
  Lightning:  ${lightningLabel}
  Auth:       ${authLabel}
  Price:      ${priceLabel}
  Storage:    ${config.storage}${config.storage === 'memory' ? ' (ephemeral)' : ''}
  Local:      http://localhost:${config.port}
${config.rootKeyGenerated ? `
  ! Using auto-generated root key (not persisted across restarts)
  ! Set ROOT_KEY env var for production use` : ''}

  /.well-known/l402  |  /llms.txt  |  /health
`)

    // Start tunnel if enabled
    if (config.tunnel) {
      tunnelResult = await startTunnel(config.port)
      if (tunnelResult.url) {
        console.log(`  Public:     ${tunnelResult.url}`)
      } else if (tunnelResult.error) {
        console.log(`  Tunnel:     ${tunnelResult.error}`)
      }
    } else {
      console.log('  Tunnel:     disabled')
    }
  })

  const shutdown = () => {
    if (tunnelResult?.process) stopTunnel(tunnelResult.process)
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
