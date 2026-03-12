import { readFileSync, existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { loadConfig, type CliArgs } from './config.js'
import { createTokenTollServer } from './server.js'

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
    if (configPath.endsWith('.json')) {
      return JSON.parse(content)
    }
    // YAML config requires js-yaml; fall back to JSON parse for .yaml files
    // that happen to be valid JSON, otherwise warn
    try {
      return JSON.parse(content)
    } catch {
      console.warn(`[token-toll] YAML config requires 'js-yaml' package. Use JSON format or install js-yaml.`)
      console.warn(`[token-toll] Ignoring config file: ${configPath}`)
      return {}
    }
  } catch {
    console.warn(`[token-toll] Could not read config file: ${configPath}`)
    return {}
  }
}

function printHelp(): void {
  console.log(`
  token-toll - Lightning-paid AI inference

  Usage: token-toll [options]

  Options:
    --upstream <url>       Upstream inference API URL (required)
    --port <number>        Listen port (default: 3000)
    --config <path>        Config file path (default: token-toll.yaml if exists)
    --price <sats>         Default price per 1k tokens (default: 1)
    --max-concurrent <n>   Max concurrent inference requests (default: unlimited)
    --storage <type>       memory | sqlite (default: memory)
    --db-path <path>       SQLite database path (default: ./token-toll.db)
    --free-tier <n>        Free requests per IP per day (default: 0)
    --trust-proxy          Trust X-Forwarded-For headers
    -h, --help             Show help
    -v, --version          Show version
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

  const { app } = createTokenTollServer({ ...config, models })

  let version = '0.1.0'
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    version = pkg.version
  } catch { /* ignore */ }

  serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(`
  token-toll v${version}

  > Upstream:    ${config.upstream}
  > Models:      ${models.length > 0 ? models.join(', ') : '(none detected)'}
  > Pricing:     ${config.pricing.default} sat / 1k tokens (default)
  > Storage:     ${config.storage}${config.storage === 'memory' ? ' (ephemeral)' : ''}
  > Lightning:   Cashu-only (no backend configured)
  > Payment:     http://localhost:${config.port}
${config.rootKeyGenerated ? `
  ! Using auto-generated root key (not persisted across restarts)
  ! Set ROOT_KEY env var for production use` : ''}

  Ready. Accepting payments.
`)
  })
}
