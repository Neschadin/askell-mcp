# Contributing to askell-mcp

Maintainer notes. End users: see [README.md](./README.md).

## Develop locally

```bash
cp .env.example .env
# production keys → .env
# sandbox keys → .env.sandbox  (gitignored; Bun does **not** auto-load this file)
bun install
```

`.env.sandbox` is the right split. Do **not** put `ASKELL_ENV=sandbox` in `.env` if you also run prod from this cwd. Bun auto-loads only `.env` / `.env.local` / `.env.$NODE_ENV` — never `.env.sandbox`. Parallel processes:

```bash
bun run dev:prod      # --no-env-file --env-file=.env
bun run dev:sandbox   # --no-env-file --env-file=.env.sandbox
```

Checkout without publishing (this repo's Cursor `mcp.json` already does this — no keys in JSON):

```json
{
  "mcpServers": {
    "askell-prod": {
      "command": "bun",
      "args": ["--no-env-file", "--env-file=.env", "run", "bin/askell-mcp@latest"]
    },
    "askell-sandbox": {
      "command": "bun",
      "args": ["--no-env-file", "--env-file=.env.sandbox", "run", "bin/askell-mcp@latest"]
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
