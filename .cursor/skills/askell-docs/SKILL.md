---
name: askell-docs
description: >-
  Fetch live Áskell/Askell product docs (llms.txt index, then the page).
  Training data is stale. Use when the task touches Askell domain: v1 vs v2
  subscriptions, catalog, quotes, checkouts, billing runs, customers, payments,
  3D Secure, embedded checkout, webhooks, wallet passes, API keys, or when
  editing server instructions, analysis tools, resources, eval questions.
  Skip for MCP protocol/SDK work (that is mcp-docs).
---

# Live Askell docs

Prose docs move independently of the bundled OpenAPI. **Live pages beat memory.**

## Sources

| What | Where | How |
|---|---|---|
| LLM index (start here) | https://docs.askell.is/llms.txt | Fetch, pick the page, fetch that URL |
| OpenAPI v1/v2 (endpoints) | `spec/openapi-v1.json`, `spec/openapi-v2.json` | Already in repo; refresh with `bun run sync-specs` |
| Runtime MCP resources | `askell://spec/v1`, `askell://spec/v2`, `askell://docs/webhook-events` | For MCP *clients*, not Cursor-agent context |

Index pages (from [llms.txt](https://docs.askell.is/llms.txt)):

- Getting started — https://docs.askell.is/en/getting_started/index.html
- Authentication — https://docs.askell.is/en/api/authentication.html
- Subscription Contracts V2 — https://docs.askell.is/en/api/subscription_contracts_v2.html
- Subscriptions (legacy) — https://docs.askell.is/en/api/subscriptions.html
- Payments — https://docs.askell.is/en/api/payments.html
- 3D Secure — https://docs.askell.is/en/api/3dsecure.html
- Embedded checkout — https://docs.askell.is/en/api/embedded_checkout.html
- Payment pages — https://docs.askell.is/en/api/payment_pages.html
- Webhooks — https://docs.askell.is/en/api/webhooks.html
- Wallet pass barcodes — https://docs.askell.is/en/api/wallet_pass_barcodes.html

Prefer `/en/`. Icelandic is `/is/`.

Live Swagger JSON (`askell.is/api/swagger/*.json`) is **upstream only** — input to `bun run sync-specs`. Do not fetch it to answer schema questions. v1 is overlaid in `src/openapi/patch-v1.ts` (drops fake `POST /your-webhook-url/`, Customer read schema, missing success bodies). Bundled `spec/openapi-v1.json` is the patched document (`info.x-askell-mcp-patched`). Most inbound webhook **payloads** are still not in OpenAPI — `askell://docs/webhook-events`. Exception: `fulfillment_order.*` is `V2FulfillmentOrder`. `style`/`explode` are stripped at describe time for MCP `outputSchema`, not because Askell is wrong.

## Fetch strategy

1. Fetch https://docs.askell.is/llms.txt if the index may have changed.
2. Fetch the **specific page** for the flow you are implementing (not the whole site).
3. Path/method/schema: bundled `spec/openapi-v*.json`, then overlays in this repo. Prose + captured payloads beat OpenAPI for flows swagger omits (embedded session sub-paths, 3DS iframe, most webhook bodies). Bundled spec beats prose when swagger moved first: finalize payment-method rules, quote `customer` / `combo_discounts` / coupon vs `recurring_*`, hosted checkout `shipping` / `allowed_origin` / `shipping_fee`, coupon catalog `/v2/coupons/` `/v2/promotion-codes/`, `fulfillment_order.*` / `GET /v2/fulfillment-orders/` / `POST .../fulfill/` / `POST .../cancel/`, legacy guard codes, `POST /v2/billing-runs/{id}/refund/`, `apply_at` / `change-anchor` / scheduled-change cancel. Request body schema beats the operation description when they disagree (`V2SubscriptionContractPatch` vs the PATCH description).
4. Cite the page URL. Do not dump the whole page into chat.

## Known traps (docs vs OpenAPI)

- Auth: `Authorization: Api-Key <key>`. Public key is browser-safe for a few endpoints only.
- New integrations: V2 (`/v2/`). v1 is PlanVariant + Subscription.
- Typical V2: catalog → quote → payment-processor-options → checkout → finalize → poll billing run.
- Quotes: pass `customer` (numeric id) when the buyer already exists, else combo discounts from their other active contracts and promo-code customer restrictions are skipped. First-period totals already include coupon + combo. `quote.recurring_*` include combo, **not** the coupon — renewal-with-coupon is `discount.recurring_final_amount` while duration still applies (`once` → after first payment use `recurring_*`). Combo is automatic, not `apply-code`.
- `finalize`: recurring offer needs a verified payment method even when due-now is 0 (trial / 100% off first period). Only a free one-time purchase finalizes without one. Live V2 page still says “unless 0 ISK” — bundled OpenAPI is right.
- Hosted `POST /v2/checkouts/`: `shipping` is required when the offer has physical products and the account has shipping options. No shipping-options list in OpenAPI (option ids are account config). Snapshot is `contract.shipping_selection` (plus `location` / `zone_name` / `weight_band`), not `V2Checkout`. Rate-table option with no zip/weight rate: `400`, `shipping_code=shipping_not_available`. Quote/checkout totals already include `shipping_fee` when present. Embedded widget collects address/shipping.
- Coupons: catalog CRUD is `/v2/coupons/` and `/v2/promotion-codes/` (secret). Coupon = discount definition; promotion code = customer-facing code. Create: exactly one of `amount_off`+`currency` or `percent_off`; `duration_in_months` iff `duration=repeating`. Redeemed coupon/code cannot DELETE — retire coupon with `redeem_by`/`max_redemptions`, promo with `active=false` (frees `code`). Contract still uses `POST .../apply-code/` `{promotion_code}` (one active). Live V2 page does not document the catalog yet; bundled spec is right.
- Fulfillment: `GET /v2/fulfillment-orders/` and `GET .../{id}/` are warehouse reads (secret; same body as `fulfillment_order.*` = `V2FulfillmentOrder`). Mutate: `POST .../fulfill/` (optional body) and `POST .../cancel/` (no body). Idempotent `200` if already in that state (no second webhook/email). `409`: `order_cancelled` | `order_fulfilled` | `booking_in_progress`. External carrier: shipment `handler` is `""` — read `carrier`. `403` if contracts/shipping/fulfillment off. Poll `updated_since` after a missed webhook. Live webhook page names `created`, `shipment_booked` (extra `shipment_id`), `fulfilled`, `cancelled`. Swagger operation text only names `fulfilled` and `cancelled`. Do not invent `changed`.
- Hosted iframe (not `askell.js`): `allowed_origin` on `POST /v2/checkouts/` and payment-method-registrations (one origin, no path; `http` only localhost/loopback). Replaces account-level `frame-ancestors`. Rejected on `/v2/checkout-sessions/` — that uses sales-channel `allowed_origins[]`.
- Checkout/session metadata copies onto the contract at finalize except Askell-owned keys (`askell_source`, `billing_anchor_mode`, `activation_failure`, `email_markers`, `copied_legacy_pauses`, `copied_legacy_extra_data`, `migration_source`, `migration_cadence_mode`, `legacy_subscription_ids`, `seed`). On a shared key the session value wins. PATCH `metadata` replaces integration keys; those Askell keys keep their current values and are ignored if sent.
- Legacy writes: `400` `LegacySubscriptionGuardError`, match `code`. Not every v1 write — customer, webhook, and one-off payment writes are not this guard. `legacy_subscriptions_disabled` on contracts-only accounts (`POST /subscriptions/multi/` neither creates nor updates the customer, `POST /customers/{ref}/subscriptions/add/` also sends `status: error`, `POST /checkouts/` with a `plan`; processor checkout still works). `subscription_managed_by_contract` on PATCH/cancel/activate/set_expiry (`migrated_to_contract_id`, `v2_endpoint`). `askell_describe_operation` omits response descriptions, so these codes are only on the 400 body in the bundled spec.
- Contract `reference`: max 128, no commas. Create blank means none. PATCH `null`/blank clears. List filter is exact. PATCH body is only `metadata`, `reference`, `payment_processor_override`. The PATCH description also names `delivery_address` / `accounting_department` / `accounting_cost_center`; `V2SubscriptionContractPatch` does not — do not send them.
- Item changes: `apply_at=now` (default) rejects a future `effective_at` (`future_effective_at_not_supported`). `apply_at=period_end` charges nothing now (`scheduled_change`, `change_id` null) and cannot be combined with `effective_at` / `settlement_behavior` / `include_pending_adjustments`. Pending scheduled change → `409` `scheduled_change_exists` until `POST .../scheduled-changes/{id}/cancel/` (`replayed: true` if already canceled; `scheduled_change_not_cancelable` if applied/failed). `items/add` and `items/remove` can `409` too; their operation text does not say so. Immediate interval change with an amount due: `pending_interval_change.status=awaiting_payment`, item switches only when that run succeeds; other item edits and change-anchor `409` `pending_interval_change` until then. A failed payment abandons the interval change; retrying the run does not apply it.
- Anchor: `POST /v2/subscription-contracts/{id}/change-anchor/` (not PATCH `billing_anchor_at`). `new_billing_anchor_at` after `effective_at`, and with proration at most one billing period later. Does not extend entitlements. Preview: `proration-preview` `operation=change_anchor`.
- Refunds: a billing-run charge is not a Payment. `payment.*` is two shapes: v1 one-off has `transactions[]`; a v2 billing-run charge is flat (`Hook-API-Version: v2`, `subscription_contract_id`, `billing_run_id`, `billing_run_attempt_id`). `payment.retry` on that charge may have a null `uuid` and a run state such as `retry_scheduled`. `POST /v2/billing-runs/{id}/refund/` (no body, full amount only). `200` → `refunded` + `billing_run.changed` (no separate event). `202` → still `succeeded`; do not resend immediately. `POST /payments/{uuid}/refund/` is one-off Payments only. Live release notes do not document this yet.
- Webhooks: non-migrated `subscription_contract.*` is the GET contract. `customer` is an object; the numeric id is `customer_id`. `reference` and `scheduled_changes` are on that body (the example JSON omits `scheduled_changes`; the next paragraph names it). `migrated` is short and its `customer` is a number (`migration_batch_id`, `migration_effective_at`, `legacy_subscription_ids`, `legacy_source_mappings`). A scheduled cancellation sends `ended`, not `canceled`, even though `state` becomes `canceled`. `subscription_contract_scheduled_change.*` and `subscription_contract_item.entitlement_changed` are separate registrations. Billing-run webhooks use `contract_id`, not `contract`. Live `state` includes `retry_scheduled`, `failed_terminal`, `voided`, `refunded`.
- Embedded checkout: secret key creates a scoped session server-side; browser gets only the session token + `askell.js`.
- `checkout_url` on V2 checkout objects is the API URL, not a hosted payment page.
- `subscriber_page` on `V2SubscriptionContract` is the customer-facing management URL (readOnly, nullable). Not `checkout_url`, not v1 `/public/payments/{id}/`. Live V2 page does not document it yet; bundled spec is right. Do not POST it.
- Webhook body **is the event object**, not `{ event, data }`. HMAC-SHA512 of raw body (`Hook-HMAC`). Details: `askell://docs/webhook-events` / `src/resources/register.ts`.
- `GET /webhooks/` returns plaintext `hmac_secret` on every list/get/create (not create-only). MCP tool output redacts it; do not trust the old “Askell will not show it again” line.
- Two API hosts, same v1/v2 surface: production `https://askell.is/api` and sandbox `https://sandbox.askell.is/api` (isolated tenant; keys from that dashboard). Official prose still documents Test Gateway and may omit the sandbox host.
- Test Gateway is a payment acquirer (fake cards) on either host, not a separate API. Point MCP at sandbox with a second `mcp.json` entry (`askell-sandbox`) + `ASKELL_ENV=sandbox`.

## Do not

- Copy the docs site into `spec/` or `src/resources/` as a snapshot of every HTML page.
- Put Askell prose into `mcp-docs` (that skill is protocol/SDK only).
- Invent coupon/checkout/webhook/shipping/fulfillment shapes from training data. There is no shipping-options list in OpenAPI. Do not invent `fulfillment_order.changed`. Do not send PATCH fields that are only in an operation description (`delivery_address`, `accounting_*`). Do not treat `subscription_contract.*` as including `subscription_contract_scheduled_change.*` or `subscription_contract_item.*`. Do not read a non-migrated contract webhook's `customer` as a number.
