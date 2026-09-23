// Copies the landing page into the build output, where the compiled server
// looks for it (dist/src/server.js -> dist/page/index.html). tsc only emits
// TypeScript, so without this step the npm package ships no page.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(process.argv[2] ?? join(root, 'dist'))
const target = join(outDir, 'page', 'index.html')

mkdirSync(dirname(target), { recursive: true })
cpSync(join(root, 'src', 'page', 'index.html'), target)
console.log(`Copied landing page to ${target}`)
