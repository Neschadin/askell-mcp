# askell-mcp

[MCP](https://modelcontextprotocol.io) server for the [Askell](https://askell.is) payment and subscription API.

Connect it to Cursor, Claude Desktop, or any MCP client to discover Askell endpoints, inspect customers/contracts/billing, and call the API — with confirmation before mutating requests.

## Requirements

- An [Askell](https://askell.is) account and **secret API key** (from the Askell dashboard)
- One of:
  - [Bun](https://bun.sh) ≥ 1.3.14 (for `bunx`), or
  - a prebuilt binary from [Releases](https://github.com/Neschadin/askell-mcp/releases) (no Bun needed)

## Quick start

### 1. Get API keys

In the Askell dashboard, copy your **private (secret)** API key. Optionally also the **public** key (only needed for temporary payment-method / checkout status endpoints).

### 2. Add to your MCP client

**With Bun** (`bunx`):

```json
{
  "mcpServers": {
    "askell": {
      "command": "bunx",
      "args": ["-y", "askell-mcp"],
      "env": {
        "ASKELL_PRIVATE_API_KEY": "your_secret_api_key"
      }
    }
  }
}
```

**With a binary** (download `askell-mcp-<os>-<arch>` from [Releases](https://github.com/Neschadin/askell-mcp/releases), then `chmod +x`):

```json
{
  "mcpServers": {
    "askell": {
      "command": "/absolute/path/to/askell-mcp-linux-x64",
      "env": {
        "ASKELL_PRIVATE_API_KEY": "your_secret_api_key"
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
| `ASKELL_API_URL`                   | no       | `https://askell.is/api` | API base URL (_or_ `ASKELL_API_BASE_URL`)       |
| `ASKELL_RESPONSE_MAX_BYTES`        | no       | `64000`                 | Max response size returned to the model         |
| `ASKELL_REQUIRE_MUTATION_APPROVAL` | no       | `true`                  | Confirm before POST/PUT/PATCH/DELETE            |

Askell has **no separate sandbox host** — production and test traffic use the same URL. Use the **Áskell Test Gateway** acquirer in your dashboard for safe payment testing. See [Askell getting started](https://docs.askell.is/en/getting_started/index.html).

## What you can do

Typical agent workflow:

1. **Discover** — `askell_list_operations` / `askell_describe_operation` (from bundled OpenAPI v1 + v2)
2. **Support tasks** — customer/contract/billing helpers below
3. **Anything else** — `askell_call` for a raw endpoint (mutations ask for approval when enabled)

### Tools

| Tool                        | Description                              |
| --------------------------- | ---------------------------------------- |
| `askell_list_operations`    | Search bundled OpenAPI operations        |
| `askell_describe_operation` | Params and body schema for one operation |
| `askell_call`               | Call any v1/v2 endpoint                  |
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
- Paths use **trailing slashes**
- Prefer **v2** for new integrations; v1 remains for existing ones
- Docs: [docs.askell.is](https://docs.askell.is/) · OpenAPI: [v1](https://askell.is/api/swagger/swagger.json) · [v2](https://askell.is/api/swagger/v2/swagger.json)

## License

[MIT](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development, tests, and releases.
