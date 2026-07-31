# askell-mcp

MCP server for [Askell](https://askell.is) payment and subscription API — monitoring, discovery, and operator-approved mutations.

Built with [Bun](https://bun.sh) and [@modelcontextprotocol/server](https://ts.sdk.modelcontextprotocol.io/v2/) (MCP TypeScript SDK v2).

**Requires [Bun](https://bun.sh) ≥ 1.1.**

Distributed as an npm package for `bunx`, plus optional compiled binaries on GitHub Releases.

## Install (users)

### Option A — bunx (recommended)

Requires Bun on the machine. In Cursor / Claude Desktop `mcp.json`:

```json
{
  "mcpServers": {
    "askell": {
      "command": "bunx",
      "args": ["-y", "askell-mcp"],
      "env": {
        "ASKELL_PRIVATE_API_KEY": "your_secret_api_key",
        "ASKELL_PUBLIC_API_KEY": "your_public_api_key_optional"
      }
    }
  }
}
```

Or globally:

```bash
bun add -g askell-mcp
askell-mcp
```

### Option B — compiled binary (no Bun at runtime)

Download the asset for your OS/arch from the [GitHub Release](https://github.com/Neschadin/askell-mcp/releases) for the version you want
(`askell-mcp-linux-x64`, `askell-mcp-darwin-arm64`, …), `chmod +x`, then:

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

See also [`mcp.json.example`](./mcp.json.example).

## Features

- **`askell_call`** — call any v1/v2 endpoint; mutating requests require operator approval via MCP elicitation
- **`askell_list_operations` / `askell_describe_operation`** — discover endpoints from bundled OpenAPI specs
- **Analysis helpers** — `askell_paginate_all`, `askell_customer_overview`, `askell_contract_overview`, `askell_billing_run_triage`, `askell_list_webhooks`
- **Resources** — bundled OpenAPI v1/v2 specs and webhook event reference

## Askell environments

Askell does **not** expose a separate sandbox/staging API host. Production and test integrations use the same base URL:

```text
https://askell.is/api
```

Testing is done with the **Áskell Test Gateway** payment acquirer in your Askell account dashboard, not via a different API hostname. See [Askell Set Up docs](https://docs.askell.is/en/getting_started/index.html).

`apiBaseUrl` remains configurable in case Askell adds environments later.

## Configuration

| Variable                                            | Required | Default                 |
| --------------------------------------------------- | -------- | ----------------------- |
| `ASKELL_PRIVATE_API_KEY` or `ASKELL_SECRET_API_KEY` | yes      | —                       |
| `ASKELL_PUBLIC_API_KEY`                             | no       | —                       |
| `ASKELL_API_URL` or `ASKELL_API_BASE_URL`           | no       | `https://askell.is/api` |
| `ASKELL_RESPONSE_MAX_BYTES`                         | no       | `64000`                 |
| `ASKELL_REQUIRE_MUTATION_APPROVAL`                  | no       | `true`                  |

## Develop locally

```bash
cp .env.example .env
# edit keys
bun install
bun run dev
```

Bun loads `.env` automatically from the project root.

From a checkout (without publishing):

```json
{
  "mcpServers": {
    "askell": {
      "command": "bun",
      "args": ["run", "bin/askell-mcp"],
      "cwd": "/absolute/path/to/askell-mcp",
      "env": {
        "ASKELL_PRIVATE_API_KEY": "..."
      }
    }
  }
}
```

Unit tests (no network):

```bash
bun test
```

Live smoke / integration (needs `ASKELL_PRIVATE_API_KEY` in `.env`):

```bash
bun run smoke
bun run test:integration
```

Inspector:

```bash
bun run inspect
```

## Sync OpenAPI specs

```bash
bun run sync-specs
```

Downloads:

- v1: https://askell.is/api/swagger/swagger.json
- v2: https://askell.is/api/swagger/v2/swagger.json

## Release

Push a semver tag (e.g. `v0.1.0`). CI runs: **validate** → **build** (4 cross-compiled binaries on Ubuntu) → **GitHub Release** (with `SHA256SUMS`) → **npm publish** (OIDC).

Prerelease tags (`v0.1.0-rc.1`) mark the GitHub release as prerelease and publish npm under the `next` dist-tag.

### npm Trusted Publishing (required)

Classic `NPM_TOKEN` + 2FA fails CI with `EOTP`. Use OIDC only:

1. Create the package on [npmjs.com](https://www.npmjs.com/) (empty / first manual publish if the name is new)
2. Open **askell-mcp** → **Settings** → **Trusted Publisher** → GitHub Actions:
   - Organization or user: `Neschadin`
   - Repository: `askell-mcp`
   - Workflow filename: `release.yml` (filename only)
3. Do **not** set `NPM_TOKEN` / `NODE_AUTH_TOKEN` in the repo — workflow uses `id-token: write`
4. After a successful OIDC publish, revoke any legacy automation tokens and prefer “Require 2FA and disallow tokens”

Local binary builds:

```bash
bun run build:linux-x64
# → dist/askell-mcp-linux-x64
```

Dry-run pack:

```bash
npm pack --dry-run
```

## Tools

| Tool                        | Description                               |
| --------------------------- | ----------------------------------------- |
| `askell_list_operations`    | Search bundled OpenAPI operations         |
| `askell_describe_operation` | Full params/body schema for one operation |
| `askell_call`               | Raw API call with mutation approval       |
| `askell_paginate_all`       | Auto-follow paginated list endpoints      |
| `askell_customer_overview`  | v1 customer + subscriptions               |
| `askell_contract_overview`  | v2 contract + billing runs                |
| `askell_billing_run_triage` | v2 billing run + optional contract        |
| `askell_list_webhooks`      | v1 webhook management list                |

## Evaluation

`evaluation.xml` has 10 read-only Q&A pairs for testing whether an LLM can use these tools effectively. Run with the skill harness if present:

```bash
python .agents/skills/mcp-tool-design/scripts/evaluation.py \
  -t stdio -c bun -a run bin/askell-mcp \
  -e ASKELL_PRIVATE_API_KEY=... \
  -o evaluation_report.md \
  evaluation.xml
```

## License

MIT
