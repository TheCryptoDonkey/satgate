#!/usr/bin/env node
import { main } from '../src/cli.js'
main().catch((err) => {
  console.error('[satgate] Fatal:', err.message)
  process.exit(1)
})
