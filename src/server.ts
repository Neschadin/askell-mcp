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

/**
 * Combined array elements and object members allowed in one `tools/call`
 * `arguments` payload. Off in the SDK by default; set here so a wide or deep
 * JSON body cannot be walked before schema validation. Legitimate Askell
 * writes (checkout, contract, webhook) sit far under this.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

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
- v1 (legacy): PlanVariant + Subscription at paths like /subscriptions/, /customers/. Customer, webhook, and one-off payment writes are not this guard. Legacy subscription writes can 400 with LegacySubscriptionGuardError — match \`code\`, not the message (askell_describe_operation omits response descriptions). \`legacy_subscriptions_disabled\`: contracts-only account, on POST /subscriptions/multi/ (customer is neither created nor updated), POST /customers/{ref}/subscriptions/add/ (that body also has \`status: error\`), and POST /checkouts/ with a plan (payment_processor checkout still works). \`subscription_managed_by_contract\`: that subscription's billing moved; PATCH/cancel/activate/set_expiry. Body has migrated_to_contract_id and v2_endpoint.
- v2 (current): Catalog, bundles, quotes, checkouts, subscription contracts, billing runs, coupons/promotion codes, fulfillment orders under /v2/. Prefer v2 for new integrations.
- Prose docs at https://docs.askell.is/api/ may describe flows (embedded checkout, 3D Secure, wallet passes) not fully listed in OpenAPI.

API layout:
- v1 paths have no prefix (e.g. /customers/, /subscriptions/, /webhooks/).
- v2 paths start with /v2/ (e.g. /v2/subscription-contracts/, /v2/billing-runs/).
- Askell paths use trailing slashes.
- V2 list endpoints paginate only when page_size is provided (default 10, max 1000).
- GET /v2/customer-entitlements/ requires customer_reference query param.

V2 discounts — not the v1 percent field Subscription.discount (0-100 on a PlanVariant; never send that to v2). v1 promotion codes are a separate system, below. Coupon = discount definition; promotion code = customer-facing code:
- Catalog (secret): CRUD /v2/coupons/ and /v2/promotion-codes/. Create coupon: exactly one of amount_off+currency or percent_off; duration_in_months required iff duration=repeating (omit otherwise); redeem_by must be future. PATCH type switch: send the old field as null. Redeemed coupon/code cannot DELETE — retire coupon with redeem_by/max_redemptions, promo with active=false (frees code for reuse). List/get hide soft-deletes. Promo code is uppercased and generated if omitted; unique among active; restrict with customer xor customer_reference.
- Scope: applies_to_plans (legacy plan ids) and applies_to_products (catalog product ids). Both empty applies to everything. Once either list has an entry, the coupon only applies to what is listed: a legacy subscription is discounted only while its plan is in applies_to_plans, a V2 contract line only when its product is in applies_to_products. A plans-only coupon gives nothing on contracts; a products-only coupon gives nothing on legacy subscriptions. On a contract, percent_off is that percentage of the in-scope lines and amount_off is at most their total. A code is refused when nothing in the quote, the order, or on the contract is in scope. Create: [] clears a list. PATCH: omit a list to leave it, [] clears it. contract.discount.coupon does not include these arrays — GET /v2/coupons/{id}/. Live coupons page (https://docs.askell.is/en/api/coupons.html) does not document applies_to_* yet; bundled OpenAPI is right.
- Contract: one active discount. GET /v2/subscription-contracts/{id}/discount/ (also nested as contract.discount). Apply with POST .../apply-code/ {promotion_code}. Remove with POST .../remove-discount/.
- Quotes (POST /v2/subscription-offer-quotes/): pass promotion_code for coupons. When quoting an existing customer, pass customer (numeric id) or combo discounts from their other active contracts and promo-code customer restrictions are skipped. First-period subtotal/tax/total already include coupon + combo. quote.recurring_* include combo, not the coupon — renewal-with-coupon is discount.recurring_final_amount, and only while duration still applies (once → after first payment use recurring_*). combo_discounts[] and discount.recurring_* are on the quote response (askell_describe_operation omits response schemas). Combo is automatic, not apply-code. A product-scoped coupon discounts only applies_to_products lines; the code is refused when none of the offer's products is in scope. A plans-only coupon is refused on a contract quote.

V1 promotion codes — not Subscription.discount (0-100). Live subscription docs do not describe these yet; bundled OpenAPI is right:
- First charge: promotion_code on POST /customers/{customerReference}/subscriptions/add/, or on each item of POST /subscriptions/multi/. apply-code does not discount the first charge.
- Preview: POST /subscriptions/quote/ (secret). Nothing is created, stored, redeemed, or charged, and the redemption count is unchanged. Not a hold — creation validates the code again. Side-effect free, but it is POST: use askell_mutate. Body: plan (required); optional promotion_code, amount, discount, customer_reference, reference, start_date. With customer_reference, reference reuses that subscription, so its stored amount, discount percentage, and recurring flag apply. The quote is refused when that subscription is already active, or already carries an active or pending discount (with a code). 400 is invalid_promotion_code or legacy_subscriptions_disabled. askell_describe_operation omits the response. first_charge is null when the subscription does not renew and the first charge is not immediate (trial or future start_date). renewal is null when it does not renew: a reused subscription keeps its own recurring flag, a new one takes the plan's. Without promotion_code, customer_reference plus reference returns existing_discount (active or pending) that creation keeps; applies_to_plan false means the prices are undiscounted. On a new code, applies_to_plan is always true, otherwise the code is refused. A customer with billing history gets no trial; without customer_reference the customer is treated as new. amount on the quote is what would be stored (discount as a whole percent, amount to four decimal places, half away from zero). An immediate first charge uses amount and discount exactly as sent. Live subscription docs do not describe this endpoint yet.
- POST /checkouts/ promotion_code requires a plan. The checkout redeems nothing. The code is applied only when that checkout's token is payment_method.token on POST /subscriptions/multi/, on the first item for that plan that has no promotion_code of its own (an item's own code wins). POST .../subscriptions/add/ does not carry the checkout code over. Unless capture_only, that item's discounted first charge must equal the amount the checkout quoted, or the request is 400 before the payment method is stored. A customer-restricted code cannot be used at checkout (no customer yet). A coupon limited to other plans is refused.
- One discount per subscription, including a pending one from a future start_date. GET /subscriptions/{subscriptionId}/discount/ reports a pending discount as has_discount: false, but apply-code still returns 400 until remove-discount. discount.id on that response and on apply-code is a string (di_…), not an integer. No path takes it.
- POST /subscriptions/{subscriptionId}/apply-code/ body {code, subscription_token}. POST .../remove-discount/ body {subscription_token}. GET .../discount/?subscription_token=. subscription_token is Subscription.token. Treat it as a secret. These three paths are apiKeyKind none: do not send Authorization.
- An invalid, expired, used-up, customer-restricted, or plan-scoped code (applies_to_plans / applies_to_products does not include this plan) on add, multi, checkout, or quote is 400 before the subscription is created or charged. On multi the customer may already have been created or updated. The same code on several multi items needs a redemption left for each. A coupon that skips the trial charges the discounted first period immediately, unless start_date is in the future. legacy_subscriptions_disabled still refuses add, multi, a plan checkout, and the quote.

V2 checkout notes:
- checkout_url on V2 checkouts points to the API object URL, not a hosted payment page.
- GET contract.subscriber_page is the customer-facing subscription management URL (readOnly, nullable). Not checkout_url, not v1 /public/payments/{id}/ (hosted signup). Do not send it on create/patch.
- finalize: a recurring offer needs a verified payment method even when due-now/total is 0 (trial or fully discounted first period). Only a free one-time purchase finalizes without one. Live docs still say "unless 0 ISK" — ignore that; bundled OpenAPI is right.
- Hosted POST /v2/checkouts/: shipping {option, location_id?} is required when the offer has physical products and the account has active shipping options. No shipping-options list in OpenAPI (ids are account config). Pickup options need location_id. Snapshot is contract.shipping_selection (plus location / zone_name / weight_band), not on V2Checkout. Rate-table option with no zip/weight rate: 400, shipping_code shipping_not_available. Quote/checkout totals already include shipping_fee when present.
- Hosted iframe (not askell.js): POST /v2/checkouts/ and POST .../payment-method-registrations/ take allowed_origin (one origin, no path; http only localhost/loopback). Replaces account-level frame-ancestors; GET empty string = account-level. Rejected on /v2/checkout-sessions/ (sales-channel allowed_origins[]).
- Embedded checkout uses POST /v2/checkout-sessions/ plus browser session-token sub-paths (widget collects address/shipping; see docs, not all in OpenAPI).
- contract_reference (max 128, no commas, blank or null means none, not unique): the seller backend sets it on POST /v2/checkouts/ (no session) or POST /v2/checkout-sessions/ (secret). Copied to contract.reference when the contract is created, so it is already on subscription_contract.created and GET /v2/subscription-contracts/?reference= returns a list. Do not PATCH reference afterwards — too late for subscription_contract.created. The browser cannot set it: sending contract_reference while creating a checkout in the session is 400, and it is absent from the public session payload and browser responses. A checkout created inside a session has contract_reference null; the contract takes the session's value. GET /v2/checkout-sessions/{token}/ returns the session reference; GET /v2/checkouts/{token}/ returns the checkout's.
- Checkout/session metadata is copied onto the contract at finalize except Askell-owned keys (askell_source, billing_anchor_mode, activation_failure, email_markers, copied_legacy_pauses, copied_legacy_extra_data, migration_source, migration_cadence_mode, legacy_subscription_ids, seed). On a shared key the session value wins.

V2 contract changes:
- reference: external id, max 128, no commas, not unique. Create: blank means none. PATCH null/blank clears. GET /v2/subscription-contracts/?reference= is an exact filter. For a checkout-created contract, set contract_reference on the checkout or session (checkout notes); a later PATCH misses subscription_contract.created.
- PATCH body is only metadata, reference, payment_processor_override. The operation description also lists delivery_address, accounting_department, accounting_cost_center; V2SubscriptionContractPatch does not include them — do not send them.
- PATCH metadata replaces the integration's keys. The Askell-owned keys above keep their current values; sending them does nothing.
- items/update apply_at=now (default): effective_at must not be in the future (400 future_effective_at_not_supported). apply_at=period_end charges nothing now and stores scheduled_change (change_id null); do not send effective_at, settlement_behavior, include_pending_adjustments, or apply_on_payment with it (apply_on_payment → 400 invalid_apply_at). A pending scheduled change rejects further item updates with 409 scheduled_change_exists until POST .../scheduled-changes/{scheduledChangeId}/cancel/ (already canceled → replayed: true; applied/failed → 409 scheduled_change_not_cancelable). items/add and items/remove can also 409 (V2ProrationConflict); their operation text does not say so. Webhook families subscription_contract_scheduled_change.* and subscription_contract_item.* are not part of subscription_contract.*. Non-migrated contract events match GET: customer is an object, numeric id is customer_id. A scheduled cancellation sends subscription_contract.ended, not canceled, even though state becomes canceled.
- An immediate billing-interval change with an amount due sets item.pending_interval_change and item.pending_change (interval_change true, status awaiting_payment, applies_on_payment). The item switches only when that billing run succeeds. Other item edits and change-anchor return 409 pending_interval_change until then. A failed payment abandons the interval change; retrying the run does not apply it.
- apply_on_payment (default false; items/update and proration-preview; apply_at=now only): false switches the item now and collects afterwards. true keeps the current values until the proration run is collected, without moving the billing schedule. Same-interval (an upgrade): pending_interval_change is null; the wait is only pending_change (interval_change false, status awaiting_payment). Renewal is held. Other item edits and change-anchor return 409 pending_change — change-anchor's operation text only names pending_interval_change. Needs invoice_now (400 apply_on_payment_requires_invoice_now). Nothing to collect (no proration, a downgrade, or a charge fully covered) applies at once. A terminal failure leaves the item unchanged; a later manual retry that succeeds still applies the change unless the item was changed or its renewal billed in the meantime, in which case the payment is credited to the contract balance. Send the same apply_on_payment on proration-preview: a preview token only validates an update with the same value.
- POST .../change-anchor/ moves the next renewal of the contract and every active item. new_billing_anchor_at must be after effective_at and, with proration, at most one billing period later. Does not extend entitlements. Preview with proration-preview operation=change_anchor (new_billing_anchor_at required). Do not PATCH billing_anchor_at.

V2 payment methods:
- V2CustomerPaymentMethod.card is brand, last4, funding. null for claim and invoice. funding is null for Teya, and for Valitor Pay until the card's first successful charge. Visa Electron is visa.

V2 refunds:
- A billing-run charge is not a Payment. payment.* for that charge is a flat object (Hook-API-Version v2, subscription_contract_id, billing_run_id, billing_run_attempt_id), not transactions[]; a payment.retry may have a null uuid and state retry_scheduled. Refund with POST /v2/billing-runs/{id}/refund/ (no body, full amount only, secret). 200 → state refunded, metadata.transaction_refund, webhook billing_run.changed (no separate refund event). 202 → run still succeeded (metadata.refund_requests); wait or re-GET; do not resend immediately. 400 if not succeeded, zero amount, already refunded, or the processor cannot refund. No response (timeout): GET the run and check state plus metadata.refund_requests before retrying. POST /payments/{uuid}/refund/ is one-off Payments only.

V2 fulfillment (warehouse):
- GET /v2/fulfillment-orders/ and GET /v2/fulfillment-orders/{id}/. Same body as fulfillment_order.* webhooks (V2FulfillmentOrder). Secret key. 403 if contracts/shipping off. Poll updated_since after a missed webhook (newest first).
- POST .../{id}/fulfill/ marks shipped (body optional: tracking_number, tracking_url, provider_order_id, carrier, weight_grams). POST .../{id}/cancel/ (no body). Both idempotent 200 if already in that state (no second webhook/email). 409: order_cancelled | order_fulfilled | booking_in_progress (retry shortly). 403 if fulfillment is switched off. External carrier with no Askell integration: shipment.handler is "" — read carrier.

Auth:
- Most endpoints need the secret API key.
- Only temporary payment method and checkout status endpoints use the public key.
- v1 subscription discount paths (apply-code, discount, remove-discount) are apiKeyKind none: no Authorization header. Pass subscription_token (Subscription.token) and treat that token as a secret. Omit apiKeyKind on askell_call/askell_mutate to follow the operation.

Safety:
- Writes go through askell_mutate (destructiveHint). Reads go through askell_call (readOnlyHint).
- mutationGate=auto (default): confirmation form only if this request's envelope declared form elicitation; otherwise the client's own tool-allow UI is the gate. elicit always returns a form (SDK refuses if the client cannot fulfil it). off never asks.
- Large list responses are compacted (index of id/dates/plan/customer) to fit responseMaxBytes before dropping rows; check meta.truncatedByMaxBytes, meta.compacted, and meta.compactedMode.
- Tool arguments are rejected when they contain more than ${MAX_TOOL_INPUT_ELEMENTS} combined array elements and object members. The call returns isError and names the limit; shrink the JSON body or query.
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
      maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
    },
  );

  const client = new AskellClient(config);

  registerDiscoveryTools(server);
  registerCallTools(server, client, config);
  registerAnalysisTools(server, client);
  registerResources(server);

  return server;
}
