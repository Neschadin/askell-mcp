import { describe, expect, test } from 'bun:test';
import * as z from 'zod';

import { operationRegistry } from '../openapi/registry.ts';
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
