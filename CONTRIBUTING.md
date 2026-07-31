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

Checkout without publishing (Cursor `mcp.json`):

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

## Tests

```bash
bun test                 # unit (no network)
bun run typecheck
bun run smoke            # needs .env
bun run test:integration # needs .env
bun run inspect          # MCP Inspector
```

## Sync OpenAPI specs

```bash
bun run sync-specs
```

- v1: https://askell.is/api/swagger/swagger.json
- v2: https://askell.is/api/swagger/v2/swagger.json

## Local binary build

```bash
bun run build:linux-x64
# → dist/askell-mcp-linux-x64
```

```bash
npm pack --dry-run
```

## Evaluation

`evaluation.xml` — read-only Q&A pairs for agent evals. Example harness:

```bash
python .agents/skills/mcp-tool-design/scripts/evaluation.py \
  -t stdio -c bun -a run bin/askell-mcp \
  -e ASKELL_PRIVATE_API_KEY=... \
  -o evaluation_report.md \
  evaluation.xml
```
