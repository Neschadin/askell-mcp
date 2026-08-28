---
name: mcp-docs
description: >-
  Fetch live MCP specification and TypeScript SDK v2 docs. Training data is stale —
  use this whenever the task touches MCP protocol or @modelcontextprotocol/server.
  Triggers: tools, resources, prompts, elicitation, input_required, completion,
  notifications, stdio, Streamable HTTP, authorization, capability negotiation,
  Inspector, registerTool, serveStdio, Zod 4 schemas, protocol 2026-07-28.
  Skip only for Askell-domain work with zero protocol/SDK questions.
---

# MCP live docs (protocol + TS SDK v2)

Spec and SDK move faster than training data. **Live docs beat memory.** This project is already an MCP **v2** stdio server (`@modelcontextprotocol/server`, `serveStdio`, `registerTool`). Do not scaffold a new server (that is `typescript-mcp-server-generator`). Do not re-design the tool catalog (that is `mcp-tool-design`).

## Sources

| What | Index | How to read |
|---|---|---|
| Protocol, Inspector, security | https://modelcontextprotocol.io/llms.txt | MCP tools first, then fetch page `.md` URLs |
| TypeScript SDK v2 (2026-07-28) | https://ts.sdk.modelcontextprotocol.io/v2/llms.txt | Fetch index, then the page's `.md` URL |

Every SDK page is also plain markdown at the same path with `.md` (e.g. [tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.md)). Full dump: https://ts.sdk.modelcontextprotocol.io/v2/llms-full.txt — only if you need many pages at once.

Prefer **2026-07-28** (and `docs/2026-07-28/…`). Ignore older spec eras in the protocol `llms.txt` unless the user names one.

## Fetch strategy

### Protocol — MCP tools first

If `search_model_context_protocol` is connected:

1. `search_model_context_protocol({ query })`
2. Read the page with `query_docs_filesystem_model_context_protocol` (`head`/`cat` the `.mdx` path). Do **not** treat that tool as a real shell.

Fallback if those tools are missing:

1. Fetch https://modelcontextprotocol.io/llms.txt
2. Pick the **2026-07-28** (or `specification/2026-07-28`) URL
3. Fetch that `.md` URL

### TypeScript SDK v2

1. If Context7 is available: `resolve-library-id` then `query-docs` with library `/websites/ts_sdk_modelcontextprotocol_io_v2` (or `/modelcontextprotocol/typescript-sdk`).
2. Else fetch https://ts.sdk.modelcontextprotocol.io/v2/llms.txt, pick the page, fetch its `.md` URL.

Quick map (SDK v2):

- Tools / `registerTool` → `servers/tools.md`
- Resources → `servers/resources.md`
- Prompts → `servers/prompts.md`
- Completion → `servers/completion.md`
- Logging, progress, cancel → `servers/logging-progress-cancellation.md`
- Elicitation → `servers/elicitation.md`
- `input_required` (not sunset sampling) → `servers/input-required.md`
- Errors → `servers/errors.md`
- stdio / `serveStdio` → `serving/stdio.md`
- Testing → `testing.md`
- v1 → v2 → `migration/upgrade-to-v2.md`
- 2026-07-28 protocol on v2 packages → `migration/support-2026-07-28.md`

## This repo

- Runtime: Bun, stdio, `@modelcontextprotocol/server@2`, `zod@4`.
- Handlers: `(args, ctx)` — use `ctx.mcpReq`, not v1 `extra`.
- Elicitation for mutations is already in `src/tools/mutation-gate.ts`. Do **not** paste v1 `server.elicitInput` / `extra.signal` snippets from old skills.
- Sampling / `createMessage` / `roots` are sunset in v2 — do not add them.
- SSE / WebSocket transports are gone — do not generate them.

## Presenting

- Cite the page URL.
- Keep RFC 2119 MUST/SHOULD/MAY.
- Extract what this change needs; do not dump whole spec pages.
