import { describe, expect, test } from 'bun:test';

import {
  PRODUCTION_API_BASE_URL,
  SANDBOX_API_BASE_URL,
  type AppConfig,
} from './config.ts';
import { buildServerInstructions } from './server.ts';
import { PACKAGE_VERSION } from './version.ts';
import packageJson from '../package.json' with { type: 'json' };

const baseConfig: AppConfig = {
  askellEnv: 'production',
  apiBaseUrl: PRODUCTION_API_BASE_URL,
  secretApiKey: 'secret.key',
  responseMaxBytes: 64_000,
  mutationGate: 'auto',
};

describe('PACKAGE_VERSION', () => {
  test('matches package.json (MCP initialize version)', () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});

describe('buildServerInstructions', () => {
  test('names the sandbox instance without treating it as production', () => {
    const sandbox = buildServerInstructions({
      ...baseConfig,
      askellEnv: 'sandbox',
      apiBaseUrl: SANDBOX_API_BASE_URL,
    });

    expect(sandbox).toContain(`This instance: sandbox (${SANDBOX_API_BASE_URL})`);
    expect(sandbox).toContain(`production: ${PRODUCTION_API_BASE_URL}`);
    expect(sandbox).toContain(
      `sandbox (isolated tenant, separate API keys): ${SANDBOX_API_BASE_URL}`,
    );
    expect(sandbox).toContain('ASKELL_ENV=production|sandbox');
    expect(sandbox).toContain('askell_list_operations');
    expect(sandbox).toContain('hmac_secret');
    expect(sandbox).toContain('<redacted len=N>');
    expect(sandbox).not.toContain(
      `This instance: production (${PRODUCTION_API_BASE_URL})`,
    );
  });

  test('defaults instance to production', () => {
    const prod = buildServerInstructions(baseConfig);
    expect(prod).toContain(
      `This instance: production (${PRODUCTION_API_BASE_URL})`,
    );
  });

  test('labels a custom API base', () => {
    const custom = buildServerInstructions({
      ...baseConfig,
      askellEnv: 'custom',
      apiBaseUrl: 'http://localhost:8000/api',
    });
    expect(custom).toContain(
      'This instance: custom API base http://localhost:8000/api',
    );
  });

  test('encodes v2 quote combo, finalize PM, and shipping traps', () => {
    const text = buildServerInstructions(baseConfig);

    expect(text).toContain('pass customer (numeric id)');
    expect(text).toContain('combo_discounts[]');
    expect(text).toContain('Combo is automatic, not apply-code');
    expect(text).toContain(
      'recurring offer needs a verified payment method even when due-now/total is 0',
    );
    expect(text).toContain('Live docs still say "unless 0 ISK"');
    expect(text).toContain('shipping {option, location_id?}');
    expect(text).toContain('No shipping-options list in OpenAPI');
    expect(text).toContain('contract.shipping_selection');
    expect(text).toContain('GET contract.subscriber_page');
    expect(text).toContain('Not checkout_url, not v1 /public/payments/{id}/');
    expect(text).toContain(
      'First-period subtotal/tax/total already include coupon + combo',
    );
    expect(text).toContain('quote.recurring_* include combo, not the coupon');
    expect(text).toContain('discount.recurring_final_amount');
    expect(text).toContain('allowed_origin');
    expect(text).toContain('Rejected on /v2/checkout-sessions/');
    expect(text).toContain('GET /v2/fulfillment-orders/');
    expect(text).toContain('fulfillment_order.* webhooks');
    expect(text).toContain('shipping_code shipping_not_available');
    expect(text).toContain('shipping_fee');
    expect(text).toContain('POST .../{id}/fulfill/');
    expect(text).toContain('POST .../{id}/cancel/');
    expect(text).toContain('order_cancelled | order_fulfilled | booking_in_progress');
    expect(text).toContain('shipment.handler is ""');
    expect(text).toContain('CRUD /v2/coupons/');
    expect(text).toContain('/v2/promotion-codes/');
    expect(text).toContain('exactly one of amount_off+currency or percent_off');
    expect(text).toContain('active=false');
    expect(text).not.toContain('cannot mark shipped via the API');
    expect(text).not.toContain('warehouse, read-only');
  });
});
