import { describe, expect, test } from 'bun:test';
import * as z from 'zod';

import { getBundledSpec, operationRegistry } from '../openapi/registry.ts';
import { operationDetailSchema } from './discovery.ts';

describe('askell_describe_operation payload', () => {
  test('strips OpenAPI style/explode so outputSchema can accept the payload', () => {
    const dirty = {
      id: 'v2:GET:/v2/billing-runs/{billingRunId}/',
      apiVersion: 'v2',
      method: 'GET',
      path: '/v2/billing-runs/{billingRunId}/',
      tags: ['V2 Billing Runs'],
      summary: 'Get a V2 billing run',
      parameters: [
        {
          name: 'billingRunId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          style: 'simple',
          explode: false,
        },
      ],
      apiKeyKind: 'secret',
    };

    const parsed = operationDetailSchema.parse(dirty);
    expect(parsed.parameters[0]).toEqual({
      name: 'billingRunId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    expect(parsed.parameters[0]).not.toHaveProperty('style');
    expect(parsed.parameters[0]).not.toHaveProperty('explode');
  });

  test('retry billing-run body requires reason', () => {
    const operation = operationRegistry.getById(
      'v2:POST:/v2/billing-runs/{billingRunId}/retry/',
    );
    expect(operation).toBeDefined();

    const payload = operationDetailSchema.parse(operation);
    const schema = payload.requestBody?.schema as { required?: string[] };
    expect(schema.required).toEqual(['reason']);

    for (const parameter of payload.parameters) {
      expect(parameter).not.toHaveProperty('style');
      expect(parameter).not.toHaveProperty('explode');
    }
  });

  test('quote create accepts customer for combo/promo context', () => {
    const operation = operationRegistry.getById(
      'v2:POST:/v2/subscription-offer-quotes/',
    );
    expect(operation).toBeDefined();

    const payload = operationDetailSchema.parse(operation);
    const schema = payload.requestBody?.schema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('customer');
    expect(schema.properties).toHaveProperty('promotion_code');
  });

  test('hosted checkout create includes shipping selection', () => {
    const operation = operationRegistry.getById('v2:POST:/v2/checkouts/');
    expect(operation).toBeDefined();

    const payload = operationDetailSchema.parse(operation);
    const schema = payload.requestBody?.schema as {
      allOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    const hasShipping = schema.allOf?.some(
      (part) => part.properties && 'shipping' in part.properties,
    );
    expect(hasShipping).toBe(true);
  });

  test('finalize describes verified PM for zero-total recurring', () => {
    const operation = operationRegistry.getById(
      'v2:POST:/v2/checkouts/{token}/finalize/',
    );
    expect(operation?.description).toMatch(/verified payment method/i);
    expect(operation?.description).toMatch(/trial period/i);
    expect(operation?.description).toMatch(/free one-time/i);
  });

  test('v2 contract schema includes read-only subscriber_page', () => {
    const spec = getBundledSpec('v2');
    const schema = spec.components?.schemas?.V2SubscriptionContract as {
      properties?: {
        subscriber_page?: { readOnly?: boolean; nullable?: boolean };
      };
    };
    expect(schema.properties?.subscriber_page?.readOnly).toBe(true);
    expect(schema.properties?.subscriber_page?.nullable).toBe(true);
  });

  test('every bundled operation parses as describe output', () => {
    for (const operation of operationRegistry.operations) {
      const result = operationDetailSchema.safeParse(operation);
      expect(result.success).toBe(true);
    }
  });

  test('output JSON Schema forbids extra parameter keys', () => {
    const jsonSchema = z.toJSONSchema(operationDetailSchema) as unknown as {
      properties: {
        parameters: { items: { additionalProperties?: boolean } };
      };
    };
    expect(jsonSchema.properties.parameters.items.additionalProperties).toBe(
      false,
    );
  });
});
