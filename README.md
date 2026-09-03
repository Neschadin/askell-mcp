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

Prefer **two server entries** if you have both production and sandbox keys. Tool names are the same on both; the client distinguishes them by the `mcp.json` key (`askell-prod` vs `askell-sandbox`). Set `ASKELL_ENV` — the server picks the host. Each instance's instructions include the environment it is talking to.

**With Bun** (`bunx`):

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "bunx",
      "args": ["-y", "askell-mcp@latest"],
      "env": {
        "ASKELL_ENV": "production",
        "ASKELL_PRIVATE_API_KEY": "your_production_secret_api_key"
      }
    },
    "askell-sandbox": {
      "command": "bunx",
      "args": ["-y", "askell-mcp@latest"],
      "env": {
        "ASKELL_ENV": "sandbox",
        "ASKELL_PRIVATE_API_KEY": "your_sandbox_secret_api_key"
      }
    }
  }
}
```

**With a binary** (download `askell-mcp-<os>-<arch>` from [Releases](https://github.com/Neschadin/askell-mcp/releases), then `chmod +x`):

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "/absolute/path/to/askell-mcp-linux-x64",
      "env": {
        "ASKELL_ENV": "production",
        "ASKELL_PRIVATE_API_KEY": "your_production_secret_api_key"
      }
    }
  }
}
```

Example file: [`mcp.json.example`](./mcp.json.example).

Restart the client after saving.

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
| `askell_list_webhooks`      | List configured webhooks                 |

### Resources

| URI                            | Content                 |
| ------------------------------ | ----------------------- |
| `askell://spec/v1`             | OpenAPI v1              |
| `askell://spec/v2`             | OpenAPI v2              |
| `askell://docs/webhook-events` | Webhook event reference |

## API notes (short)

- **v1** — legacy paths like `/customers/`, `/subscriptions/` (no `/v2` prefix)
- **v2** — current model: catalogs, quotes, checkouts, contracts, billing runs under `/v2/`
- **v2 coupons** — `GET/POST /v2/subscription-contracts/{id}/discount|apply-code|remove-discount` (one active coupon). Quotes take `promotion_code`. Not the v1 `discount` 0–100 field.
- Paths use **trailing slashes**
- Prefer **v2** for new integrations; v1 remains for existing ones
- Docs: [docs.askell.is](https://docs.askell.is/) · OpenAPI: [v1](https://askell.is/api/swagger/swagger.json) · [v2](https://askell.is/api/swagger/v2/swagger.json)

## License

[MIT](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development, tests, and releases.
