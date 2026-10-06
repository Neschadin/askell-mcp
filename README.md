# askell-mcp

[MCP](https://modelcontextprotocol.io) server for the [Askell](https://askell.is) payment and subscription API.

Connect it to Cursor, Claude Desktop, or any MCP client to discover Askell endpoints, inspect customers/contracts/billing, and call the API. Reads and writes are separate tools so clients can show their own approval UI on mutations.

## Requirements

- An [Askell](https://askell.is) account and **secret API key** (from the Askell dashboard)
- One of:
  - [Bun](https://bun.sh) ≥ 1.4.0 (for `bunx`), or
  - a prebuilt binary from [Releases](https://github.com/Neschadin/askell-mcp/releases) (no Bun needed)

## Quick start

### 1. Get API keys

In the Askell dashboard, copy your **private (secret)** API key. Optionally also the **public** key (only needed for temporary payment-method / checkout status endpoints).

### 2. Add to your MCP client

Prefer **two server entries** if you have both production and sandbox keys. Tool names are the same on both; the client distinguishes them by the server key (`askell-prod` vs `askell-sandbox`). Each instance's instructions include the environment it is talking to.

Put keys in gitignored dotenv files, not in JSON. Copy [`.env.example`](./.env.example):

- `.env` — production (`ASKELL_ENV=production` and that dashboard's keys)
- `.env.sandbox` — sandbox (`ASKELL_ENV=sandbox` and that dashboard's keys)

Bun does not auto-load `.env.sandbox`. `--no-env-file` stops the sandbox process from also reading a production `.env` that happens to sit in the cwd.

#### Cursor

Project file: `.cursor/mcp.json`. [`mcp.json.example`](./mcp.json.example) is this shape. `${workspaceFolder}` is the directory that contains that `mcp.json` (the repo root when the file is `.cursor/mcp.json`). In `~/.cursor/mcp.json`, use an absolute `envFile` path.

**With Bun:**

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "bunx",
      "args": ["--no-env-file", "x", "askell-mcp"],
      "envFile": "${workspaceFolder}/.env"
    },
    "askell-sandbox": {
      "command": "bunx",
      "args": ["--no-env-file", "x", "askell-mcp"],
      "envFile": "${workspaceFolder}/.env.sandbox"
    }
  }
}
```

**With a binary** (download `askell-mcp-<os>-<arch>` from [Releases](https://github.com/Neschadin/askell-mcp/releases), then `chmod +x`). Same `envFile`; the binary reads the environment Cursor injects:

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "/absolute/path/to/askell-mcp-linux-x64",
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

Reload the window after saving.

#### Claude Desktop

Config file:

- Linux: `~/.config/Claude/claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

No `envFile` field. The desktop process cwd is not your repo, so a relative `.env` path does not resolve. With Bun, pass an absolute `--env-file`:

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "bunx",
      "args": ["--no-env-file", "--env-file=/absolute/path/.env", "x", "askell-mcp"]
    },
    "askell-sandbox": {
      "command": "bunx",
      "args": ["--no-env-file", "--env-file=/absolute/path/.env.sandbox", "x", "askell-mcp"]
    }
  }
}
```

A binary has no `--env-file`. Put the keys in `env` (plaintext in that JSON file):

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "/absolute/path/to/askell-mcp-linux-x64",
      "env": {
        "ASKELL_ENV": "production",
        "ASKELL_PRIVATE_API_KEY": "your_production_secret_api_key",
        "ASKELL_PUBLIC_API_KEY": "your_production_public_api_key_optional"
      }
    }
  }
}
```

Quit Claude Desktop completely and reopen it. Saving the file is not enough.

#### Claude Code

Project `.mcp.json` expands `${VAR}` from the environment of the process that launched `claude`. It does not load a dotenv file. The Bun `--env-file` args from the Desktop section work here as well; a relative path is fine when you start `claude` from the repo. `${ASKELL_PRIVATE_API_KEY}` inside `env` only works when that variable is already exported in that environment. A `.env` file alone is not read.

## Configuration

| Variable                           | Required | Default                 | Description                                     |
| ---------------------------------- | -------- | ----------------------- | ----------------------------------------------- |
| `ASKELL_PRIVATE_API_KEY`           | yes\*    | —                       | Secret API key (_or_ `ASKELL_SECRET_API_KEY`)   |
| `ASKELL_PUBLIC_API_KEY`            | no       | —                       | Public key for a few checkout/payment endpoints |
| `ASKELL_ENV`                       | no       | `production`            | `production` \| `sandbox` — selects the official API host |
| `ASKELL_API_BASE_URL`              | no       | —                       | Custom/local API base only. Do not set together with `ASKELL_ENV` unless it matches |
| `ASKELL_RESPONSE_MAX_BYTES`        | no       | `64000`                 | Max response size returned to the model         |
| `ASKELL_MUTATION_GATE`             | no       | `auto`                  | `auto` / `elicit` / `off` — see below           |
| `ASKELL_REQUIRE_MUTATION_APPROVAL` | no       | —                       | Deprecated alias: `true`→`elicit`, `false`→`off` |

`ASKELL_ENV` picks a stable host (same v1/v2 surface):

- **production** — `https://askell.is/api`
- **sandbox** — `https://sandbox.askell.is/api` (isolated tenant; keys from that dashboard)

Point a second MCP server entry at sandbox (`ASKELL_ENV=sandbox`) rather than switching env on one process. Keys do not work across hosts. **Áskell Test Gateway** is a payment acquirer (fake cards) on either host — not the same as the sandbox API. Official prose at [docs.askell.is](https://docs.askell.is/en/getting_started/index.html) still documents Test Gateway and may omit the sandbox host.

`ASKELL_MUTATION_GATE`:

- **`auto` (default)** — confirmation form only if *this request's* `_meta` envelope declared form elicitation (MCP 2026-07-28). 2025-era clients (Cursor, most hosts) do not send that envelope, so the mutation runs and their own “allow this tool” UI is the gate.
- **`elicit`** — always return an elicitation form. The SDK refuses the call if the client cannot fulfil it (2026 envelope / 2025 initialize via the legacy shim).
- **`off`** — never ask (eval / trusted automation).

If both `ASKELL_MUTATION_GATE` and `ASKELL_REQUIRE_MUTATION_APPROVAL` are set, `ASKELL_MUTATION_GATE` wins.

## What you can do

Typical agent workflow:

1. **Discover** — `askell_list_operations` / `askell_describe_operation` (from bundled OpenAPI v1 + v2)
2. **Support tasks** — customer/contract/billing helpers below
3. **Anything else** — `askell_call` for GET/HEAD, `askell_mutate` for POST/PUT/PATCH/DELETE

### Tools

| Tool                        | Description                              |
| --------------------------- | ---------------------------------------- |
| `askell_list_operations`    | Search bundled OpenAPI operations        |
| `askell_describe_operation` | Params and body schema for one operation |
| `askell_call`               | GET/HEAD any v1/v2 endpoint              |
| `askell_mutate`             | POST/PUT/PATCH/DELETE any v1/v2 endpoint |
| `askell_paginate_all`       | Follow paginated list endpoints          |
| `askell_customer_overview`  | v1 customer + subscriptions              |
| `askell_contract_overview`  | v2 subscription contract + billing runs  |
| `askell_billing_run_triage` | v2 billing run (+ optional contract)     |
| `askell_list_webhooks`      | List configured webhooks (`hmac_secret` redacted) |

### Resources

| URI                            | Content                 |
| ------------------------------ | ----------------------- |
| `askell://spec/v1`             | OpenAPI v1              |
| `askell://spec/v2`             | OpenAPI v2              |
| `askell://docs/webhook-events` | Webhook event reference |

## API notes (short)

- **v1** — legacy paths like `/customers/`, `/subscriptions/` (no `/v2` prefix). Contracts-only accounts refuse new legacy subscriptions (`400`, `code: legacy_subscriptions_disabled`). A subscription whose billing moved to a contract refuses cancel/activate/set_expiry/PATCH (`code: subscription_managed_by_contract`, follow `v2_endpoint`).
- **v2** — current model: catalogs, quotes, checkouts, contracts, billing runs, coupons/promotion codes, fulfillment orders under `/v2/`
- **v2 contract changes** — `reference` (max 128, no commas) on create/patch/list filter. Item update `apply_at=now|period_end`; cancel a scheduled change with `POST .../scheduled-changes/{id}/cancel/`. Move the billing anchor with `POST .../change-anchor/`, not PATCH. PATCH accepts only `metadata`, `reference`, `payment_processor_override` — ignore the description's `delivery_address` / accounting fields; they are not on `V2SubscriptionContractPatch`.
- **v2 refunds** — billing-run charges are not Payments. `POST /v2/billing-runs/{id}/refund/` (full amount, no body). `202` means still `succeeded`; do not resend immediately. `POST /payments/{uuid}/refund/` is one-off only. `payment.*` may carry `billing_run_id`.
- **v2 discounts** — catalog CRUD `/v2/coupons/` + `/v2/promotion-codes/` (coupon = definition, promotion code = what the customer types). `applies_to_plans` / `applies_to_products`: both empty means unrestricted; once either list has an entry, only listed legacy plans or catalog products are discounted (plans-only gives nothing on contracts, products-only nothing on legacy subscriptions). On a contract, `percent_off` hits those lines and `amount_off` is at most their total; a code is refused when nothing is in scope. PATCH: omit a list to leave it, `[]` clears it. `contract.discount.coupon` omits those arrays — `GET /v2/coupons/{id}/`. Contract: `GET/POST /v2/subscription-contracts/{id}/discount|apply-code|remove-discount` (one active). Quotes take `promotion_code` and, for an existing buyer, `customer` (id) so combo discounts + promo restrictions apply. A product-scoped coupon discounts only those lines; a plans-only coupon is refused on a contract quote. First-period totals already include coupon + combo; `quote.recurring_*` include combo but not the coupon (`discount.recurring_final_amount` while the coupon is active). Recurring `finalize` needs a verified payment method even when due-now is 0. Not the v1 `discount` 0–100 field. Live [coupons](https://docs.askell.is/en/api/coupons.html) page documents the catalog and not `applies_to_*`.
- **v1 promotion codes** — not `Subscription.discount` (0–100). First charge: `promotion_code` on `POST /customers/{ref}/subscriptions/add/` or each item of `POST /subscriptions/multi/`; `apply-code` does not discount that charge. `POST /checkouts/` `promotion_code` requires a `plan`, redeems nothing, and applies only when that checkout token is `payment_method.token` on multi. Preview with `POST /subscriptions/quote/` (secret; nothing stored, redeemed, or charged). A coupon limited to other plans is `400` `invalid_promotion_code`. `discount.id` on apply-code and `GET .../discount/` is a string (`di_…`), not an integer. Live subscriptions page does not document this yet.
- **v2 fulfillment** — `GET /v2/fulfillment-orders/` for backfill; `POST .../{id}/fulfill/` (optional tracking body) and `POST .../{id}/cancel/` mark shipped/cancelled. Webhooks: `fulfillment_order.created`, `shipment_booked` (extra `shipment_id`), `fulfilled`, `cancelled`. Same body as `GET`.
- Paths use **trailing slashes**
- Prefer **v2** for new integrations; v1 remains for existing ones
- Docs: [docs.askell.is](https://docs.askell.is/) · OpenAPI: [v1](https://askell.is/api/swagger/swagger.json) · [v2](https://askell.is/api/swagger/v2/swagger.json)

## License

[MIT](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development, tests, and releases.
