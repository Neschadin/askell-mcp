---
name: askell-mcp
description: >-
  Operate the askell-mcp server: discovery tools, read vs mutate calls, analysis
  shortcuts, bundled OpenAPI and webhook resources, prod vs sandbox, and mutation
  confirmation. Pair with the askell-docs skill for live product docs and traps.
---

# askell-mcp server workflow

This MCP server wraps the Askell REST API (v1 legacy + v2 contracts). Server `instructions` summarize key domain rules; this skill is the **tooling** map.

## Environment

- **production** — `https://askell.is/api` (`ASKELL_ENV=production`, default).
- **sandbox** — `https://sandbox.askell.is/api` (separate tenant and API keys; `ASKELL_ENV=sandbox`).
- v1 paths have no prefix; v2 paths start with `/v2/`. Trailing slashes matter (a redundant leading `/api/` prefix is stripped automatically).

Connect prod and sandbox as **two** MCP server entries if you need both.

## Discovery first

1. `askell_list_operations` — filter by `apiVersion`, `tag`, `method`, `pathPrefix`, `search` (matches path, summary, description, tags, and error codes), `apiKeyKind`. Check **`totalMatched`**, not only `operations.length` (default `limit` 50).
2. `askell_describe_operation` — parameters, request body schema, per-status `responses` descriptions / `schemaRef` / `errorCodes`, `apiKeyKind`, deprecation. `operationId` from the list (e.g. `v2:GET:/v2/billing-runs/`).

Bundled OpenAPI (offline, full 2xx response schemas): resources `askell://spec/v1`, `askell://spec/v2`. Webhook payload shapes (mostly not in OpenAPI): `askell://docs/webhook-events`.

## Calling the API

| Intent                      | Tool            |
| --------------------------- | --------------- |
| GET / HEAD                  | `askell_call`   |
| POST / PUT / PATCH / DELETE | `askell_mutate` |

- `path` — relative to API base (e.g. `/v2/subscription-contracts/` or `/v2/claim-rules/`). Do **not** embed `?query=...` inside `path` — pass query params in `query`.
- `query`, `body` — JSON as needed.
- `apiKeyKind` — omit to follow the operation: `secret` (most), `public` (checkout/temp PM status), `none` (v1 subscription discount paths with `subscription_token` only).

Responses are JSON text. `hmac_secret` in webhook bodies is redacted in tool output (`<redacted len=N>`); use the dashboard or a direct API call for the real secret. Customer-portal `url` and `token` are not redacted: hand `url` to the browser, and send `token` as `Authorization: Customer-Session <token>` — never in a URL.

## Analysis shortcuts (prefer over raw GET loops)

- `askell_customer_overview` — v1 customer + v1 subscriptions, plus optional `includeV2Contracts: true` to fetch v2 contracts in parallel.
- `askell_contract_overview` — one v2 contract (including `service_entitlement_policy`, `discount`, `scheduled_changes`) + recent billing runs (`claim`, `refunded_amount`).
- `askell_billing_run_triage` — billing run state, attempts, `claim` (`pending_external` bank claims), refund amounts, and optional related contract.
- `askell_paginate_all` — walk v1 and v2 paginated list endpoints (pass `page_size` in `query`, e.g. `{ page_size: 100 }`).
- `askell_list_webhooks` — registered webhook endpoints (`hmac_secret` redacted).

Use `askell_call` when no shortcut covers the path.

## Mutations and safety

- `askell_mutate` is `destructiveHint`; hosts should show approval UI.
- `mutationGate=auto` (default): if the client declared **form elicitation**, you get a confirm form (`confirm: true`); otherwise the host’s tool-approval UI is the gate.
- Large tool **arguments** are capped (`maxToolInputElements`); shrink huge JSON bodies.
- Large **responses** may be compacted or truncated — read `meta` in `askell_paginate_all`, `askell_call`, and `askell_mutate` output when present.

## Skills on this server (SEP-2640)

- **askell-docs** — live docs.askell.is, OpenAPI overlays, integration traps (coupons, checkout, webhooks, bank claims, refunds, legacy guard).
- **askell-mcp** — this file.

Use `skills/list` and `skills/get` (or your host’s Skills UI) to load them on demand instead of relying on training data.

## Do not

- Use `askell_call` for POST/PUT/PATCH/DELETE (use `askell_mutate`).
- Pass query parameters inside `path` (use `query`).
- Treat `subscriber_page` as a seller-verified login. That is `POST /v2/customer-portal-entries/` (hosted page) or `POST /v2/customer-portal-sessions/` (on-site widget).
- Treat `202` on `POST /payments/{uuid}/cancel/`, `POST /v2/billing-runs/{id}/cancel-claim/`, or refund endpoints as an error.
- Reuse production API keys on sandbox or vice versa.
