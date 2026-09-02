# Contributing to askell-mcp

Maintainer notes. End users: see [README.md](./README.md).

## Develop locally

```bash
cp .env.example .env
# set ASKELL_PRIVATE_API_KEY
bun install
bun run dev
```

Bun loads `.env` from the project root.

Checkout without publishing (Cursor `mcp.json`). Two entries if you use sandbox — keys are per host:

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "bun",
      "args": ["run", "bin/askell-mcp"],
      "cwd": "/absolute/path/to/askell-mcp",
      "env": {
        "ASKELL_ENV": "production",
        "ASKELL_PRIVATE_API_KEY": "..."
      }
    },
    "askell-sandbox": {
      "command": "bun",
      "args": ["run", "bin/askell-mcp"],
      "cwd": "/absolute/path/to/askell-mcp",
      "env": {
        "ASKELL_ENV": "sandbox",
        "ASKELL_PRIVATE_API_KEY": "..."
      }
    }
  }
}
```

## Tests

```bash
bun test                 # unit (no network)
bun run typecheck
bun run smoke            # needs .env
bun run test:integration # needs .env
bun run eval:tools       # evaluation.xml via stdio (needs .env; Q9–Q10 are live data)
bun run inspect          # MCP Inspector
```

## Sync OpenAPI specs

```bash
bun run sync-specs
```

Fetches Askell swagger, then **v1 is overlaid** (`src/openapi/patch-v1.ts`: drop inbound `Webhook calls` dummy path, split Customer read vs create, fill missing 201/200 bodies) before writing `spec/openapi-v*.json`.

- v1 upstream: https://askell.is/api/swagger/swagger.json
- v2: https://askell.is/api/swagger/v2/swagger.json (unpatched)

## Local binary build

```bash
bun run build:linux-x64
# → dist/askell-mcp-linux-x64
```

```bash
npm pack --dry-run
```

## Evaluation

`evaluation.xml` is scored by a deterministic stdio driver (no LLM):

```bash
bun run eval:tools
```

It calls the same MCP tools an agent would (`askell_list_operations`, `askell_describe_operation`, `askell_call`, `askell_paginate_all`, resources) and string-compares answers. Q9–Q10 query the live Askell account and will fail if those date windows drift — update the `<answer>` if the data changed.

An optional Claude harness exists in the mcp-tool-design skill (`evaluation.py`); do not use it as CI. Default model there is EOL; it also needs `ANTHROPIC_API_KEY`.
