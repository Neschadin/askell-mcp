import { describe, expect, test } from 'bun:test';

import { getBundledSpec, operationRegistry } from './registry.ts';
import {
  ASKELL_V1_PATCH,
  WEBHOOK_CALLS_TAG,
  patchAskellV1Spec,
} from './patch-v1.ts';

function upstreamV1(): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'Áskell API', version: '1.0.0' },
    tags: [
      { name: 'Customer' },
      { name: WEBHOOK_CALLS_TAG, description: 'inbound dummy' },
      { name: 'Webhooks' },
    ],
    paths: {
      '/customers/': {
        post: {
          tags: ['Customer'],
          responses: { '201': { description: 'ok' } },
        },
      },
      '/customers/{customerReference}/': {
        put: {
          tags: ['Customer'],
          responses: { '200': { description: 'ok' } },
        },
        patch: {
          tags: ['Customer'],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/your-webhook-url/': {
        post: {
          tags: [WEBHOOK_CALLS_TAG],
          requestBody: {
            $ref: '#/components/requestBodies/SubscriptionMultiLite',
          },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/webhooks/': {
        post: {
          tags: ['Webhooks'],
          responses: { '201': { description: 'ok' } },
        },
      },
      '/webhooks/{id}/': {
        patch: {
          tags: ['Webhooks'],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      schemas: {
        Customer: {
          allOf: [{ $ref: '#/components/schemas/CustomerCreate' }],
        },
        CustomerCreate: { type: 'object' },
        Webhook: { type: 'object' },
        PaymentMethod: { type: 'object' },
      },
    },
  };
}

describe('patchAskellV1Spec', () => {
  test('drops inbound Webhook calls dummy path and tag', () => {
    const patched = patchAskellV1Spec(upstreamV1());
    expect(patched.paths?.['/your-webhook-url/']).toBeUndefined();
    expect(patched.tags?.map((tag) => tag.name)).toEqual([
      'Customer',
      'Webhooks',
    ]);
  });

  test('replaces Customer GET model and adds CustomerAddress', () => {
    const patched = patchAskellV1Spec(upstreamV1());
    const customer = patched.components?.schemas?.Customer as {
      allOf?: unknown;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(customer.allOf).toBeUndefined();
    expect(customer.required).toContain('id');
    expect(customer.required).toContain('address');
    expect(customer.properties?.email).toEqual({
      type: 'string',
      nullable: true,
      maxLength: 254,
    });
    expect(patched.components?.schemas?.CustomerAddress).toBeDefined();
  });

  test('fills missing success JSON bodies', () => {
    const patched = patchAskellV1Spec(upstreamV1());
    const postCustomer = patched.paths?.['/customers/']?.post?.responses?.[
      '201'
    ] as { content?: { 'application/json'?: { schema?: { $ref?: string } } } };
    expect(postCustomer.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/Customer',
    );

    const patchWebhook = patched.paths?.['/webhooks/{id}/']?.patch
      ?.responses?.['200'] as {
      content?: { 'application/json'?: { schema?: { $ref?: string } } };
    };
    expect(patchWebhook.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/Webhook',
    );
  });

  test('is idempotent', () => {
    const once = patchAskellV1Spec(upstreamV1());
    const twice = patchAskellV1Spec(once);
    expect(twice).toEqual(once);
    expect(twice.info?.['x-askell-mcp-patched']).toBe(ASKELL_V1_PATCH);
  });

  test('does not mutate the input document', () => {
    const input = upstreamV1();
    patchAskellV1Spec(input);
    expect(input.paths).toHaveProperty('/your-webhook-url/');
  });
});

describe('bundled spec/openapi-v1.json', () => {
  test('is already overlaid (sync-specs output)', () => {
    const spec = getBundledSpec('v1') as {
      info?: Record<string, unknown>;
      paths?: Record<string, unknown>;
      components?: { schemas?: { Customer?: { required?: string[] } } };
    };
    expect(spec.info?.['x-askell-mcp-patched']).toBe(ASKELL_V1_PATCH);
    expect(spec.paths?.['/your-webhook-url/']).toBeUndefined();
    expect(spec.components?.schemas?.Customer?.required).toContain('address');
    expect(
      operationRegistry.getById('v1:POST:/your-webhook-url/'),
    ).toBeUndefined();
  });
});
