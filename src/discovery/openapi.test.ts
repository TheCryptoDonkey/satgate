import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec, type OpenApiInput } from './openapi.js'
import { readPackageVersion } from '../version.js'

describe('generateOpenApiSpec', () => {
  it('generates valid OpenAPI 3.1 structure', () => {
    const spec = generateOpenApiSpec({
      models: ['llama3'],
      pricing: { default: 1, models: { llama3: 2 } },
    })
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('satgate')
    expect(spec.paths).toHaveProperty('/v1/chat/completions')
    expect(spec.paths).toHaveProperty('/v1/models')
  })

  it('includes L402 security scheme', () => {
    const spec = generateOpenApiSpec({
      models: ['llama3'],
      pricing: { default: 1, models: {} },
    })
    expect(spec.components.securitySchemes).toHaveProperty('l402')
  })

  it('includes x402 security scheme when configured', () => {
    const spec = generateOpenApiSpec({
      models: ['llama3'],
      pricing: { default: 1, models: {} },
      x402: true,
    })
    expect(spec.components.securitySchemes).toHaveProperty('x402')
  })

  it('omits x402 security scheme when not configured', () => {
    const spec = generateOpenApiSpec({
      models: ['llama3'],
      pricing: { default: 1, models: {} },
    })
    expect(spec.components.securitySchemes).not.toHaveProperty('x402')
  })

  it('reports the package version rather than a fixed 1.0.0', () => {
    const spec = generateOpenApiSpec({ models: [], pricing: { default: 1, models: {} } })
    expect(spec.info.version).toBe(readPackageVersion())
    expect(spec.info.version).not.toBe('1.0.0')
  })

  it('declares the IETF Payment scheme and lets any scheme authorise inference', () => {
    const spec = generateOpenApiSpec({ models: [], pricing: { default: 1, models: {} }, lightning: true, cashu: true })
    expect(spec.components.securitySchemes.payment).toMatchObject({ type: 'http', scheme: 'Payment' })
    expect(spec.components.securitySchemes.cashu).toMatchObject({ type: 'apiKey', name: 'X-Cashu' })
    expect(spec.paths['/v1/chat/completions'].post.security).toEqual([{ l402: [] }, { payment: [] }, { cashu: [] }])
  })

  it('declares no Lightning schemes without Lightning', () => {
    const spec = generateOpenApiSpec({ models: [], pricing: { default: 1, models: {} }, lightning: false, cashu: true })
    expect(Object.keys(spec.components.securitySchemes)).toEqual(['cashu'])
  })
})
