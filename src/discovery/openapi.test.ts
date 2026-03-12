import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec, type OpenApiInput } from './openapi.js'

describe('generateOpenApiSpec', () => {
  it('generates valid OpenAPI 3.1 structure', () => {
    const spec = generateOpenApiSpec({
      models: ['llama3'],
      pricing: { default: 1, models: { llama3: 2 } },
    })
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Token Toll')
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
})
