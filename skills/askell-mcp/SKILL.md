---
name: askell-mcp
description: >-
  Operate the askell-mcp server: discovery tools, read vs mutate calls, analysis
  shortcuts, bundled OpenAPI and webhook resources, prod vs sandbox, and mutation
  confirmation. Pair with the askell-docs skill for live product docs and traps.
---

# askell-mcp server workflow

This MCP server wraps the Askell REST API (v1 legacy + v2 contracts). Server `instructions` repeat many domain rules; this skill is the **tooling** map.

## Environment

- **production** — `https://askell.is/api` (`ASKELL_ENV=production`, default).
- **sandbox** — `https://sandbox.askell.is/api` (separate tenant and API keys; `ASKELL_ENV=sandbox`).
- v1 paths have no prefix; v2 paths start with `/v2/`. Trailing slashes matter.

Connect prod and sandbox as **two** MCP server entries if you need both.

## Discovery first

1. `askell_list_operations` — filter by `apiVersion`, `tag`, `method`, `pathPrefix`, `search`, `apiKeyKind`. Check **`totalMatched`**, not only `operations.length` (default `limit` 50).
2. `askell_describe_operation` — parameters, request body schema, `apiKeyKind`, deprecation. `operationId` from the list (e.g. `v2:GET:/v2/billing-runs/`).

Bundled OpenAPI (offline): resources `askell://spec/v1`, `askell://spec/v2`. Webhook payload shapes (mostly not in OpenAPI): `askell://docs/webhook-events`.

## Calling the API

| Intent | Tool |
|--------|------|
| GET / HEAD | `askell_call` |
| POST / PUT / PATCH / DELETE | `askell_mutate` |

- `path` — relative to API base (e.g. `/v2/subscription-contracts/`).
- `query`, `body` — JSON as needed.
- `apiKeyKind` — omit to follow the operation: `secret` (most), `public` (checkout/temp PM status), `none` (v1 subscription discount paths with `subscription_token` only).

Responses are JSON text. `hmac_secret` in webhook bodies is redacted in tool output (`<redacted len=N>`); use the dashboard or a direct API call for the real secret.

## Analysis shortcuts (prefer over raw GET loops)

- `askell_customer_overview` — customer + subscriptions/contracts context.
- `askell_contract_overview` — one v2 contract.
- `askell_billing_run_triage` — billing run state and attempts.
- `askell_paginate_all` — walk v2 list endpoints with `page_size`.
- `askell_list_webhooks` — registered webhook endpoints.

Use `askell_call` when no shortcut covers the path.

## Mutations and safety

- `askell_mutate` is `destructiveHint`; hosts should show approval UI.
- `mutationGate=auto` (default): if the client declared **form elicitation**, you get a confirm form (`confirm: true`); otherwise the host’s tool-approval UI is the gate.
- Large tool **arguments** are capped (`maxToolInputElements`); shrink huge JSON bodies.
- Large **responses** may be compacted or truncated — read `meta` in analysis tool output when present.

## Skills on this server (SEP-2640)

- **askell-docs** — live docs.askell.is, OpenAPI overlays, integration traps (coupons, checkout, webhooks, refunds, legacy guard).
- **askell-mcp** — this file.

Use `skills/list` and `skills/get` (or your host’s Skills UI) to load them on demand instead of relying on training data.

## Do not

- Use `askell_call` for POST/PUT/PATCH/DELETE (use `askell_mutate`).
- Assume `askell_describe_operation` includes response body schemas (often omitted; use live docs + `askell-docs` skill).
- Reuse production API keys on sandbox or vice versa.
