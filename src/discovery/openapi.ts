import type { ModelPricing } from '../config.js'
import { readPackageVersion } from '../version.js'

export interface OpenApiInput {
  models: string[]
  pricing: ModelPricing
  /** Lightning is configured: L402 and IETF Payment credentials are accepted. */
  lightning?: boolean
  x402?: boolean
  cashu?: boolean
  lnurlcash?: boolean
  /** Defaults to satgate's package version. */
  version?: string
}

export function generateOpenApiSpec(input: OpenApiInput): Record<string, any> {
  const spec: Record<string, any> = {
    openapi: '3.1.0',
    info: {
      title: 'satgate',
      description: 'Lightning-paid AI inference (OpenAI-compatible)',
      version: input.version ?? readPackageVersion() ?? '0.0.0',
    },
    paths: {
      '/v1/chat/completions': {
        post: {
          summary: 'Chat completions',
          description: 'OpenAI-compatible chat completions endpoint',
          security: [{ l402: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCompletionRequest' },
              },
            },
          },
          responses: {
            '200': { description: 'Successful completion' },
            '402': { description: 'Payment required' },
            '503': { description: 'Service at capacity' },
          },
        },
      },
      '/v1/completions': {
        post: {
          summary: 'Text completions (legacy)',
          security: [{ l402: [] }],
          responses: {
            '200': { description: 'Successful completion' },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/embeddings': {
        post: {
          summary: 'Embeddings',
          security: [{ l402: [] }],
          responses: {
            '200': { description: 'Successful embedding' },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/models': {
        get: {
          summary: 'List available models',
          responses: {
            '200': {
              description: 'Available models',
              content: {
                'application/json': {
                  example: {
                    data: input.models.map(id => ({ id, object: 'model' })),
                  },
                },
              },
            },
          },
        },
      },
      '/create-invoice': {
        post: {
          summary: 'Create a Lightning invoice for credits',
          responses: {
            '200': { description: 'Invoice created' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        l402: {
          type: 'http',
          scheme: 'L402',
          description: 'L402 macaroon:preimage credentials',
        },
      },
      schemas: {
        ChatCompletionRequest: {
          type: 'object',
          required: ['model', 'messages'],
          properties: {
            model: { type: 'string', enum: input.models },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                  content: { type: 'string' },
                },
              },
            },
            stream: { type: 'boolean', default: false },
          },
        },
      },
    },
  }

  const schemes = spec.components.securitySchemes
  if (input.lightning === false) delete schemes.l402
  if (input.lightning !== false) {
    schemes.payment = {
      type: 'http',
      scheme: 'Payment',
      description: 'IETF Payment authentication (draft-ryan-httpauth-payment-01), lightning method: Authorization: Payment <base64url credential>',
    }
  }
  if (input.x402) {
    schemes.x402 = {
      type: 'apiKey',
      in: 'header',
      name: 'PAYMENT-SIGNATURE',
      description: 'x402 stablecoin payment',
    }
  }
  if (input.cashu) {
    schemes.cashu = { type: 'apiKey', in: 'header', name: 'X-Cashu', description: 'Cashu ecash token (cashuB)' }
  }
  if (input.lnurlcash) {
    schemes.lnurlcash = { type: 'apiKey', in: 'header', name: 'X-LNURLcash', description: 'LUD-25 bearer note URL' }
  }

  // Any one accepted scheme authorises a paid request
  const security = Object.keys(schemes).map(name => ({ [name]: [] }))
  for (const path of ['/v1/chat/completions', '/v1/completions', '/v1/embeddings']) {
    spec.paths[path].post.security = security
  }

  return spec
}
