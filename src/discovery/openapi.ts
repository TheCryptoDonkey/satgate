import type { ModelPricing } from '../config.js'

export interface OpenApiInput {
  models: string[]
  pricing: ModelPricing
  x402?: boolean
}

export function generateOpenApiSpec(input: OpenApiInput): Record<string, any> {
  const spec: Record<string, any> = {
    openapi: '3.1.0',
    info: {
      title: 'satgate',
      description: 'Lightning-paid AI inference (OpenAI-compatible)',
      version: '1.0.0',
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

  if (input.x402) {
    spec.components.securitySchemes.x402 = {
      type: 'http',
      scheme: 'x-payment',
      description: 'x402 stablecoin payment via x-payment header',
    }
  }

  return spec
}
