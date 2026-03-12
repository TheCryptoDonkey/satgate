#!/usr/bin/env node
import { main } from '../src/cli.js'
main().catch((err) => {
  console.error('[token-toll] Fatal:', err.message)
  process.exit(1)
})
