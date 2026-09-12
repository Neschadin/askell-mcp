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

Live Swagger JSON (`askell.is/api/swagger/*.json`) is **upstream only** — input to `bun run sync-specs`. Do not fetch it to answer schema questions. v1 is overlaid in `src/openapi/patch-v1.ts` (drops fake `POST /your-webhook-url/`, Customer read schema, missing success bodies). Bundled `spec/openapi-v1.json` is the patched document (`info.x-askell-mcp-patched`). Inbound webhook **payloads** are still not in OpenAPI — `askell://docs/webhook-events`. `style`/`explode` are stripped at describe time for MCP `outputSchema`, not because Askell is wrong.

## Fetch strategy

1. Fetch https://docs.askell.is/llms.txt if the index may have changed.
2. Fetch the **specific page** for the flow you are implementing (not the whole site).
3. Path/method/schema: bundled `spec/openapi-v*.json`, then overlays in this repo. Prose + captured payloads beat OpenAPI for flows swagger omits (embedded session sub-paths, 3DS iframe, webhook bodies). Bundled spec beats prose when swagger moved first: finalize payment-method rules, quote `customer` / `combo_discounts` / coupon vs `recurring_*`, hosted checkout `shipping` / `allowed_origin`.
4. Cite the page URL. Do not dump the whole page into chat.

## Known traps (docs vs OpenAPI)

- Auth: `Authorization: Api-Key <key>`. Public key is browser-safe for a few endpoints only.
- New integrations: V2 (`/v2/`). v1 is PlanVariant + Subscription.
- Typical V2: catalog → quote → payment-processor-options → checkout → finalize → poll billing run.
- Quotes: pass `customer` (numeric id) when the buyer already exists, else combo discounts from their other active contracts and promo-code customer restrictions are skipped. First-period totals already include coupon + combo. `quote.recurring_*` include combo, **not** the coupon — renewal-with-coupon is `discount.recurring_final_amount` while duration still applies (`once` → after first payment use `recurring_*`). Combo is automatic, not `apply-code`.
- `finalize`: recurring offer needs a verified payment method even when due-now is 0 (trial / 100% off first period). Only a free one-time purchase finalizes without one. Live V2 page still says “unless 0 ISK” — bundled OpenAPI is right.
- Hosted `POST /v2/checkouts/`: `shipping` is required when the offer has physical products and the account has shipping options. No shipping-options list in OpenAPI (option ids are account config). Snapshot is `contract.shipping_selection`, not `V2Checkout`. Embedded widget collects address/shipping.
- Hosted iframe (not `askell.js`): `allowed_origin` on `POST /v2/checkouts/` and payment-method-registrations (one origin, no path; `http` only localhost/loopback). Replaces account-level `frame-ancestors`. Rejected on `/v2/checkout-sessions/` — that uses sales-channel `allowed_origins[]`.
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
- Invent coupon/checkout/webhook/shipping shapes from training data. There is no shipping-options list in OpenAPI.
