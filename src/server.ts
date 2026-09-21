import { McpServer } from '@modelcontextprotocol/server';

import { AskellClient } from './client/askell-client.ts';
import {
  PRODUCTION_API_BASE_URL,
  SANDBOX_API_BASE_URL,
  normalizeBaseUrl,
  type AppConfig,
} from './config.ts';
import { registerResources } from './resources/register.ts';
import { registerAnalysisTools } from './tools/analysis.ts';
import { registerCallTools } from './tools/call.ts';
import { registerDiscoveryTools } from './tools/discovery.ts';
import { PACKAGE_VERSION } from './version.ts';

export function buildServerInstructions(config: AppConfig): string {
  const apiBase = normalizeBaseUrl(config.apiBaseUrl);
  const envLine =
    config.askellEnv === 'custom'
      ? `This instance: custom API base ${apiBase} (ASKELL_API_BASE_URL override)`
      : `This instance: ${config.askellEnv} (${apiBase})`;

  return `Askell MCP server for payment and subscription operations.

${envLine}
Official hosts (picked by ASKELL_ENV=production|sandbox; do not pass the URL):
- production: ${PRODUCTION_API_BASE_URL}
- sandbox (isolated tenant, separate API keys): ${SANDBOX_API_BASE_URL}
v1 and v2 share that base (v2 paths start with /v2/). Keys belong to one host — do not reuse production keys on sandbox or the reverse.
Áskell Test Gateway is a payment acquirer on either host, not a separate API host.
If both askell-prod and askell-sandbox MCP servers are connected, pick the instance whose environment matches the intended tenant.

Workflow:
1. Use askell_list_operations and askell_describe_operation to discover endpoints, parameters, and auth requirements.
2. Prefer analysis tools (askell_customer_overview, askell_contract_overview, askell_billing_run_triage, askell_paginate_all, askell_list_webhooks) for common support tasks.
3. Use askell_call (GET/HEAD) or askell_mutate (POST/PUT/PATCH/DELETE) when no dedicated tool covers the request.

API models:
- v1 (legacy): PlanVariant + Subscription at paths like /subscriptions/, /customers/. Still supported for existing integrations.
- v2 (current): Catalog, bundles, quotes, checkouts, subscription contracts, billing runs, coupons/promotion codes, fulfillment orders under /v2/. Prefer v2 for new integrations.
- Prose docs at https://docs.askell.is/api/ may describe flows (embedded checkout, 3D Secure, wallet passes) not fully listed in OpenAPI.

API layout:
- v1 paths have no prefix (e.g. /customers/, /subscriptions/, /webhooks/).
- v2 paths start with /v2/ (e.g. /v2/subscription-contracts/, /v2/billing-runs/).
- Askell paths use trailing slashes.
- V2 list endpoints paginate only when page_size is provided (default 10, max 1000).
- GET /v2/customer-entitlements/ requires customer_reference query param.

V2 discounts — not v1 Subscription.discount (0-100 on a PlanVariant; never send that to v2). Coupon = discount definition; promotion code = customer-facing code:
- Catalog (secret): CRUD /v2/coupons/ and /v2/promotion-codes/. Create coupon: exactly one of amount_off+currency or percent_off; duration_in_months required iff duration=repeating (omit otherwise); redeem_by must be future. PATCH type switch: send the old field as null. Redeemed coupon/code cannot DELETE — retire coupon with redeem_by/max_redemptions, promo with active=false (frees code for reuse). List/get hide soft-deletes. Promo code is uppercased and generated if omitted; unique among active; restrict with customer xor customer_reference.
- Contract: one active discount. GET /v2/subscription-contracts/{id}/discount/ (also nested as contract.discount). Apply with POST .../apply-code/ {promotion_code}. Remove with POST .../remove-discount/.
- Quotes (POST /v2/subscription-offer-quotes/): pass promotion_code for coupons. When quoting an existing customer, pass customer (numeric id) or combo discounts from their other active contracts and promo-code customer restrictions are skipped. First-period subtotal/tax/total already include coupon + combo. quote.recurring_* include combo, not the coupon — renewal-with-coupon is discount.recurring_final_amount, and only while duration still applies (once → after first payment use recurring_*). combo_discounts[] and discount.recurring_* are on the quote response (askell_describe_operation omits response schemas). Combo is automatic, not apply-code.

V2 checkout notes:
- checkout_url on V2 checkouts points to the API object URL, not a hosted payment page.
- GET contract.subscriber_page is the customer-facing subscription management URL (readOnly, nullable). Not checkout_url, not v1 /public/payments/{id}/ (hosted signup). Do not send it on create/patch.
- finalize: a recurring offer needs a verified payment method even when due-now/total is 0 (trial or fully discounted first period). Only a free one-time purchase finalizes without one. Live docs still say "unless 0 ISK" — ignore that; bundled OpenAPI is right.
- Hosted POST /v2/checkouts/: shipping {option, location_id?} is required when the offer has physical products and the account has active shipping options. No shipping-options list in OpenAPI (ids are account config). Pickup options need location_id. Snapshot is contract.shipping_selection (plus location / zone_name / weight_band), not on V2Checkout. Rate-table option with no zip/weight rate: 400, shipping_code shipping_not_available. Quote/checkout totals already include shipping_fee when present.
- Hosted iframe (not askell.js): POST /v2/checkouts/ and POST .../payment-method-registrations/ take allowed_origin (one origin, no path; http only localhost/loopback). Replaces account-level frame-ancestors; GET empty string = account-level. Rejected on /v2/checkout-sessions/ (sales-channel allowed_origins[]).
- Embedded checkout uses POST /v2/checkout-sessions/ plus browser session-token sub-paths (widget collects address/shipping; see docs, not all in OpenAPI).

V2 fulfillment (warehouse):
- GET /v2/fulfillment-orders/ and GET /v2/fulfillment-orders/{id}/. Same body as fulfillment_order.* webhooks (V2FulfillmentOrder). Secret key. 403 if contracts/shipping off. Poll updated_since after a missed webhook (newest first).
- POST .../{id}/fulfill/ marks shipped (body optional: tracking_number, tracking_url, provider_order_id, carrier, weight_grams). POST .../{id}/cancel/ (no body). Both idempotent 200 if already in that state (no second webhook/email). 409: order_cancelled | order_fulfilled | booking_in_progress (retry shortly). 403 if fulfillment is switched off. External carrier with no Askell integration: shipment.handler is "" — read carrier.

Auth:
- Most endpoints need the secret API key.
- Only temporary payment method and checkout status endpoints use the public key.

Safety:
- Writes go through askell_mutate (destructiveHint). Reads go through askell_call (readOnlyHint).
- mutationGate=auto (default): confirmation form only if this request's envelope declared form elicitation; otherwise the client's own tool-allow UI is the gate. elicit always returns a form (SDK refuses if the client cannot fulfil it). off never asks.
- Large list responses are compacted (index of id/dates/plan/customer) to fit responseMaxBytes before dropping rows; check meta.truncatedByMaxBytes, meta.compacted, and meta.compactedMode.
- Tool output redacts webhook hmac_secret to \`<redacted len=N>\` (Askell list/get/create return the plaintext secret).

Resources:
- askell://spec/v1 and askell://spec/v2 — bundled OpenAPI
- askell://docs/webhook-events — inbound webhook payloads (most families not in OpenAPI; fulfillment_order.* is V2FulfillmentOrder), HMAC-SHA512, /webhooks/ hmac_secret`;
}

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: 'askell-mcp',
      version: PACKAGE_VERSION,
    },
    {
      instructions: buildServerInstructions(config),
    },
  );

  const client = new AskellClient(config);

  registerDiscoveryTools(server);
  registerCallTools(server, client, config);
  registerAnalysisTools(server, client);
  registerResources(server);

  return server;
}
