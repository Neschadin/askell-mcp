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

  test('hosted checkout create includes shipping selection and allowed_origin', () => {
    const operation = operationRegistry.getById('v2:POST:/v2/checkouts/');
    expect(operation).toBeDefined();

    const payload = operationDetailSchema.parse(operation);
    const schema = payload.requestBody?.schema as {
      allOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    const hasShipping = schema.allOf?.some(
      (part) => part.properties && 'shipping' in part.properties,
    );
    const hasAllowedOrigin = schema.allOf?.some(
      (part) => part.properties && 'allowed_origin' in part.properties,
    );
    expect(hasShipping).toBe(true);
    expect(hasAllowedOrigin).toBe(true);
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

  test('quote discount exposes recurring amounts without coupon in recurring_*', () => {
    const spec = getBundledSpec('v2');
    const quote = spec.components?.schemas?.V2SubscriptionOfferQuote as {
      properties?: {
        discount?: {
          properties?: Record<string, { description?: string }>;
        };
      };
    };
    const discount = quote.properties?.discount?.properties;
    expect(discount).toHaveProperty('recurring_original_amount');
    expect(discount).toHaveProperty('recurring_discount_amount');
    expect(discount).toHaveProperty('recurring_final_amount');
    expect(discount?.recurring_original_amount?.description).toMatch(
      /recurring_\* totals of the quote do not include the promotion code discount/i,
    );
  });

  test('v2 fulfillment order list, get, fulfill, and cancel are registered', () => {
    const list = operationRegistry.getById('v2:GET:/v2/fulfillment-orders/');
    expect(list).toMatchObject({
      method: 'GET',
      apiKeyKind: 'secret',
      tags: ['V2 Fulfillment'],
    });
    expect(list?.description).toMatch(/fulfillment_order\.\*/);
    expect(
      operationRegistry.getById(
        'v2:GET:/v2/fulfillment-orders/{fulfillmentOrderId}/',
      ),
    ).toBeDefined();

    const fulfill = operationRegistry.getById(
      'v2:POST:/v2/fulfillment-orders/{fulfillmentOrderId}/fulfill/',
    );
    expect(fulfill).toMatchObject({
      method: 'POST',
      apiKeyKind: 'secret',
      tags: ['V2 Fulfillment'],
    });
    expect(fulfill?.description).toMatch(/idempotent/i);
    expect(fulfill?.requestBody?.required).toBe(false);
    const fulfillSchema = fulfill?.requestBody?.schema as {
      properties?: Record<string, unknown>;
    };
    expect(fulfillSchema.properties).toHaveProperty('tracking_number');
    expect(fulfillSchema.properties).toHaveProperty('carrier');

    const cancel = operationRegistry.getById(
      'v2:POST:/v2/fulfillment-orders/{fulfillmentOrderId}/cancel/',
    );
    expect(cancel).toMatchObject({
      method: 'POST',
      apiKeyKind: 'secret',
    });
    expect(cancel?.requestBody).toBeUndefined();
    expect(cancel?.description).toMatch(/fulfillment_order\.cancelled/);
  });

  test('fulfillment order schema is the webhook body', () => {
    const spec = getBundledSpec('v2');
    const schema = spec.components?.schemas?.V2FulfillmentOrder as {
      description?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.description).toMatch(/fulfillment_order\.\*/);
    expect(schema.properties).toHaveProperty('billing_run_id');
    expect(schema.properties).toHaveProperty('fulfillments');
    expect(schema.properties).toHaveProperty('shipping_selection');
  });

  test('fulfillment shipment exposes external carrier fields', () => {
    const spec = getBundledSpec('v2');
    const schema = spec.components?.schemas?.V2Fulfillment as {
      properties?: {
        handler?: { enum?: string[] };
        carrier?: unknown;
        tracking_url?: unknown;
      };
    };
    expect(schema.properties?.handler?.enum).toContain('');
    expect(schema.properties).toHaveProperty('carrier');
    expect(schema.properties).toHaveProperty('tracking_url');
  });

  test('v2 coupon and promotion-code catalog ops are registered', () => {
    const couponList = operationRegistry.getById('v2:GET:/v2/coupons/');
    expect(couponList).toMatchObject({
      method: 'GET',
      apiKeyKind: 'secret',
      tags: ['V2 Coupons'],
    });
    expect(
      operationRegistry.getById('v2:POST:/v2/coupons/'),
    ).toBeDefined();
    expect(
      operationRegistry.getById('v2:GET:/v2/coupons/{couponId}/'),
    ).toBeDefined();
    expect(
      operationRegistry.getById('v2:PATCH:/v2/coupons/{couponId}/'),
    ).toBeDefined();
    expect(
      operationRegistry.getById('v2:DELETE:/v2/coupons/{couponId}/'),
    ).toBeDefined();

    const create = operationRegistry.getById('v2:POST:/v2/coupons/');
    const createSchema = create?.requestBody?.schema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(createSchema.required).toEqual(['duration']);
    expect(createSchema.properties).toHaveProperty('amount_off');
    expect(createSchema.properties).toHaveProperty('percent_off');

    expect(
      operationRegistry.getById('v2:GET:/v2/promotion-codes/'),
    ).toMatchObject({
      method: 'GET',
      apiKeyKind: 'secret',
      tags: ['V2 Coupons'],
    });
    const promoCreate = operationRegistry.getById(
      'v2:POST:/v2/promotion-codes/',
    );
    const promoSchema = promoCreate?.requestBody?.schema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(promoSchema.required).toEqual(['coupon']);
    expect(promoSchema.properties).toHaveProperty('code');
    expect(promoSchema.properties).toHaveProperty('customer');
    expect(promoSchema.properties).toHaveProperty('customer_reference');
    expect(
      operationRegistry.getById(
        'v2:GET:/v2/promotion-codes/{promotionCodeId}/',
      ),
    ).toBeDefined();
    expect(
      operationRegistry.getById(
        'v2:PATCH:/v2/promotion-codes/{promotionCodeId}/',
      ),
    ).toBeDefined();
    expect(
      operationRegistry.getById(
        'v2:DELETE:/v2/promotion-codes/{promotionCodeId}/',
      ),
    ).toBeDefined();
  });

  test('coupon and promotion-code schemas are in the bundled spec', () => {
    const spec = getBundledSpec('v2');
    const coupon = spec.components?.schemas?.V2Coupon as {
      properties?: Record<string, unknown>;
    };
    expect(coupon.properties).toHaveProperty('amount_off');
    expect(coupon.properties).toHaveProperty('percent_off');
    expect(coupon.properties).toHaveProperty('duration');
    expect(coupon.properties).toHaveProperty('valid');

    const promo = spec.components?.schemas?.V2PromotionCode as {
      properties?: Record<string, unknown>;
    };
    expect(promo.properties).toHaveProperty('code');
    expect(promo.properties).toHaveProperty('coupon');
    expect(promo.properties).toHaveProperty('valid');
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
