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
1. Use askell_list_operations and askell_describe_operation to discover endpoints, parameters, requestBody schemas, per-status response descriptions/errorCodes, and auth requirements.
2. Prefer analysis tools (askell_customer_overview, askell_contract_overview, askell_billing_run_triage, askell_paginate_all, askell_list_webhooks) for common support tasks.
3. Use askell_call (GET/HEAD) or askell_mutate (POST/PUT/PATCH/DELETE) when no dedicated tool covers the request.

API models:
- v1 (legacy): PlanVariant + Subscription at paths like /plans/, /subscriptions/, /customers/, /payments/. Customer, webhook, and one-off payment writes are not subject to the legacy guard. Legacy subscription writes can 400 with LegacySubscriptionGuardError — match \`code\`, not the message. \`legacy_subscriptions_disabled\`: contracts-only account, on POST /subscriptions/multi/ (customer is neither created nor updated), POST /customers/{ref}/subscriptions/add/ (body also has \`status: error\`), and POST /checkouts/ with a plan (payment_processor checkout still works). \`subscription_managed_by_contract\`: billing moved to a V2 contract; PATCH/cancel/activate/set_expiry return migrated_to_contract_id and v2_endpoint.
- v1 plans (/plans/{planId}/ GET/PUT/PATCH, secret): each entry is a PlanVariant (interval, interval_count, amount, currency are the variant's own), while payment_processor belongs to the parent Plan — updating it changes payment_processor for every variant of that plan. Sending a numeric processor id alone on a claim processor clears claim_rule_id and claim_template_id to account defaults; pass both ids in {id, claim_rule_id, claim_template_id} or neither.
- v2 (current): Catalog, bundles, quotes, checkouts, subscription contracts, billing runs, bank claims, coupons/promotion codes, customer portal, fulfillment orders under /v2/. Prefer v2 for new integrations.
- Live prose docs index: https://docs.askell.is/llms.txt (English pages under /en/api/) covers flows like embedded askell.js cart, 3D Secure, and wallet passes not fully listed in OpenAPI.

API layout:
- v1 paths have no prefix (e.g. /customers/, /subscriptions/, /webhooks/).
- v2 paths start with /v2/ (e.g. /v2/subscription-contracts/, /v2/billing-runs/, /v2/claim-rules/).
- Askell paths use trailing slashes; pass query params in \`query\`, never inside \`path\` (a redundant leading /api/ prefix is stripped automatically).
- List endpoints paginate only when page_size is provided (default 10, max 1000).
- GET /v2/customer-entitlements/ requires customer_reference query param.

V2 discounts — not the v1 percent field Subscription.discount (0-100 on a PlanVariant; never send that to v2). v1 promotion codes are a separate system, below. Coupon = discount definition; promotion code = customer-facing code:
- Catalog (secret): CRUD /v2/coupons/ and /v2/promotion-codes/. Create coupon: exactly one of amount_off+currency or percent_off; duration_in_months required iff duration=repeating (omit otherwise); redeem_by must be future. PATCH type switch: send the old field as null. Redeemed coupon/code cannot DELETE — retire coupon with redeem_by/max_redemptions, promo with active=false (frees code for reuse). Promo restrictions ({minimum_amount, minimum_amount_currency}) live on the promotion code (clear with {}), not on the coupon (live coupons.html wrongly mentions restrictions on the coupon).
- Scope: applies_to_plans (legacy plan ids, all variants), applies_to_plan_variants (one legacy variant), applies_to_products (catalog product ids, all prices), applies_to_prices (one catalog price id from GET /v2/catalog/prices/, also an offer item's price). All four empty applies to everything; once any list has an entry, only listed items are in scope. A plans-only or plan-variants-only coupon gives nothing on contracts (and is refused on a contract quote); a products-only or prices-only coupon gives nothing on legacy subscriptions. On a contract, percent_off applies to in-scope lines only and amount_off is at most their total. A code is refused when none of the offer's prices is in scope. Switching an item to an unlisted price drops the discount. PATCH: omit a list to leave it, [] clears it. contract.discount.coupon does not include these arrays — GET /v2/coupons/{id}/.
- Contract: one active discount at GET /v2/subscription-contracts/{id}/discount/ (also contract.discount). Apply with POST .../apply-code/ {promotion_code}; remove with POST .../remove-discount/.
- Quotes (POST /v2/subscription-offer-quotes/): pass customer (numeric id) for existing buyers so combo_discounts[] from their other active contracts and promo customer restrictions apply. Combo is automatic, not apply-code. First-period subtotal/tax/total already include coupon + combo; quote.recurring_* include combo, not the coupon — renewal-with-coupon is discount.recurring_final_amount while duration applies.

V1 promotion codes — not Subscription.discount (0-100):
- First charge: promotion_code on POST /customers/{customerReference}/subscriptions/add/, or per item on POST /subscriptions/multi/. apply-code does not discount the first charge.
- Preview: POST /subscriptions/quote/ (secret; side-effect free, redemption count is unchanged, use askell_mutate). Body: plan (required); optional promotion_code, amount, discount, customer_reference, reference, start_date. Reuse via customer_reference+reference returns existing_discount when promotion_code is omitted (applies_to_plan false means undiscounted). Quote amount is rounded half away from zero to 4 decimals; first_charge/renewal are null when not immediate/recurring (full schema in askell://spec/v1).
- POST /checkouts/ promotion_code requires a plan, redeems nothing, and applies only when that checkout's token is payment_method.token on POST /subscriptions/multi/ (first matching plan item without its own code; add/ does not carry it over). A coupon limited to other plans is refused.
- One discount per subscription, including a pending one (future start_date): GET .../discount/ reports has_discount: false, but apply-code still 400s until remove-discount. discount.id is a string (di_…), not an integer.
- POST /subscriptions/{subscriptionId}/apply-code/ {code, subscription_token}, POST .../remove-discount/ {subscription_token}, GET .../discount/?subscription_token= are apiKeyKind none (no Authorization header; treat subscription_token = Subscription.token as a secret).
- Plan-scoped code (applies_to_plans / applies_to_plan_variants / applies_to_products does not include this plan or plan variant) 400s on add/multi/quote (quote's 400 sentence still names only applies_to_plans / applies_to_products). legacy_subscriptions_disabled still refuses add, multi, plan checkout, and quote.

V2 checkout notes:
- checkout_url on V2 checkouts is the API URL, not a hosted payment page.
- GET contract.subscriber_page is the customer-facing management URL (readOnly, nullable; /change_contract/<token>/). Not checkout_url, not v1 /public/payments/{id}/, not a seller-verified portal link.
- finalize: a recurring offer needs a verified payment method even when due-now/total is 0 (trial or 100% discount). Only a free one-time purchase finalizes without one. Live docs still say "unless 0 ISK" — bundled OpenAPI is right.
- Hosted POST /v2/checkouts/: shipping {option, location_id?} is required when the offer has physical products and the account has active shipping options. No shipping-options list in OpenAPI. Snapshot is contract.shipping_selection, not on V2Checkout. Missing zip/weight rate: 400, shipping_code shipping_not_available. Totals include shipping_fee when present.
- Hosted iframe (not askell.js): allowed_origin on POST /v2/checkouts/ and payment-method-registrations (one origin, no path). Rejected on /v2/checkout-sessions/ (uses sales-channel allowed_origins[]).
- Embedded checkout: POST /v2/checkout-sessions/ + askell.js. V2CheckoutSession.status (in askell://spec/v2): completed means paid or awaiting processor (contract_id and initial_billing_run_id set, not necessarily active); expired means expires_at passed with no payment in flight (do not finalize again on either finalize endpoint); stays pending past expires_at while payment is in flight; activation_failure / activation_skipped keep the paid run and inactive contract.
- contract_reference (max 128, no commas, not unique): set on POST /v2/checkouts/ (no session) or POST /v2/checkout-sessions/ (secret) so contract.reference is populated before subscription_contract.created (a later PATCH is too late for subscription_contract.created). Inside a session, the checkout's own contract_reference is null and the contract takes the session's value; browser cannot set it (400).
- Checkout/session metadata copies onto the contract at finalize except Askell-owned keys (askell_source, billing_anchor_mode, activation_failure, email_markers, copied_legacy_pauses, copied_legacy_extra_data, migration_source, migration_cadence_mode, legacy_subscription_ids, seed). On a shared key the session value wins; sending Askell-owned keys on PATCH metadata does nothing.

V2 contract changes:
- PATCH /v2/subscription-contracts/{id}/ body allows ONLY metadata, reference, payment_processor_override, sales_channel (id or reference; null or blank removes the channel), and service_entitlement_policy (on_run_created | on_run_succeeded; forward-only — open runs keep their creation policy). V2SubscriptionContractPatch does not include delivery_address, accounting_department, accounting_cost_center — do not send them despite the operation description.
- Immediate cancel (POST .../cancel/): cancel_open_claims (default true; ignored on period_end/future cancels) cancels unpaid bank claims for unserved periods in the background (metadata.claim_cancellation). A prorated cancellation keeps the current period's claim open because unused-time credit settles it.
- one_off_purchases on the contract is pending only; all states (pending | billed | canceled | failed) are GET .../one-off-purchases/. No POST or DELETE.
- pending_delivery_change (null when none): post-cutoff portal address/shipping change queued for the following order (state: pending | applied | canceled | superseded); subscription_contract.changed fires when it is queued, canceled, or applied.
- scheduled_changes[].operation is update_item | add_item | remove_item; group applies/fails whole; canceling one customer interval_change cancels the others in that group.
- Customer portal (secret, askell_mutate): POST /v2/customer-portal-entries/ (5-min hosted sign-in url) and POST /v2/customer-portal-sessions/ (widget token for Authorization: Customer-Session <token>; never put in a URL; 403 self_service_unavailable is outside the V2CustomerPortalError enum). Do not redact url or token.
- items/update: apply_at=now rejects future effective_at (future_effective_at_not_supported); apply_at=period_end rejects effective_at, settlement_behavior, include_pending_adjustments, and apply_on_payment (invalid_apply_at). Pending scheduled change -> 409 scheduled_change_exists until scheduled-changes/{id}/cancel/ (scheduled_change_not_cancelable if applied/failed). Immediate interval change awaits payment (awaiting_payment); a failed payment abandons it (retrying the run does not apply it, despite the live V2 page). apply_on_payment=true (requires invoice_now -> apply_on_payment_requires_invoice_now) sets pending_change only on same-interval upgrades; preview token only validates an update with the same value.
- POST .../change-anchor/: new_billing_anchor_at after effective_at and, with proration, at most one billing period later (preview with operation=change_anchor). Do not PATCH billing_anchor_at.
- Webhooks: subscription_contract_scheduled_change.* and subscription_contract_item.* are separate from subscription_contract.*. Non-migrated contract events have customer as an object and numeric id in customer_id; scheduled cancellation sends subscription_contract.ended, not canceled.

V2 payment methods & bank claims (krafa):
- V2CustomerPaymentMethod.card is brand, last4, funding (null for claim/invoice; Visa Electron is visa).
- Claim setup (secret): GET /v2/claim-rules/ and GET /v2/claim-templates/ list active rules and bank-registered templates (G8 subscriptions, 37 invoices) ordered by id; when claim_rule_id / claim_template_id is omitted on customer PM create, the first item in each list is used.
- Open bank claims on V2BillingRun: a pending_external run waiting on a bank claim exposes run.claim (state: sent_to_bank, status: unpaid) and has transaction_id null until paid. POST /v2/billing-runs/{id}/cancel-claim/ (no body): on an active contract the run becomes failed_terminal (fail_code: claim_cancelled) and sends billing_run.failed + payment.changed + failure policy; on a canceled/ended contract the run becomes canceled (claim_cancelled_contract_closed) and sends billing_run.changed + payment.changed without failure emails/policy. 202 = bank cancelled, Askell sync pending — do not resend. POST /v2/billing-runs/{id}/change-claim/ {final_due_date: "YYYY-MM-DD"} moves eindagi (not in past, not after claim.cancellation_date).

Refunds & Payment cancellation:
- V2 billing-run charge is not a Payment (Hook-API-Version v2 flat object on payment.*). Refund via POST /v2/billing-runs/{id}/refund/ (optional {amount}; omit for full refundable_amount). Partial refund leaves state succeeded with refunded_amount and sends billing_run.changed; 202 = processor pending, do not resend immediately (refund_pending / partial_refund_not_supported; Teya RPG only the whole amount).
- POST /payments/{uuid}/refund/ is one-off Payments only (returns one Payment, not an array); POST /transactions/{uuid}/refund/ refunds legacy subscription transactions. Both 400 billing_run_charge (with billing_run_id) on a V2 billing-run charge.
- Cancel unpaid one-off Payment: POST /payments/{uuid}/cancel/ (secret, no body). Cancels unpaid bank claims at the bank first (newest attempt first), then marks Payment canceled and sends payment.changed (idempotent 200). 202 = bank cancelled claim, Payment sync pending — wait or re-GET, do not treat as failure. 409: payment_settled | payment_not_cancellable; 502: claim_cancel_refused.

V2 fulfillment (warehouse):
- GET /v2/fulfillment-orders/ and GET .../{id}/ match fulfillment_order.* webhooks (V2FulfillmentOrder). POST .../{id}/fulfill/ (optional tracking/carrier/weight) and POST .../{id}/cancel/ (no body) are idempotent 200; 409: order_cancelled | order_fulfilled | booking_in_progress. External carrier with no Askell integration has shipment.handler "" — read carrier.

Auth & safety:
- Secret key by default; public key only on temporary payment method and v1 checkout status; apiKeyKind none (no Authorization header) on v1 subscription discount paths (pass subscription_token; treat it as a secret). Omit apiKeyKind on askell_call/askell_mutate/askell_paginate_all to follow the operation.
- Writes use askell_mutate (destructiveHint; mutationGate=auto elicits only when the request's _meta envelope declared form elicitation). Reads use askell_call (readOnlyHint).
- Large lists compact before dropping rows; tool inputs cap at ${MAX_TOOL_INPUT_ELEMENTS} elements; webhook hmac_secret is redacted to \`<redacted len=N>\`.

Resources & Skills (SEP-2640, skills/list):
- askell://spec/v1, askell://spec/v2, askell://docs/webhook-events
- Skills: askell-docs (live docs + traps), askell-mcp (tool workflow on this server).`;
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
