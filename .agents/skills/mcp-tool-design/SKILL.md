---
name: mcp-tool-design
description: Design MCP tools for LLM agents — API coverage vs workflows, naming, pagination, error messages, tool annotations — and validate with evaluation suites. Pairs with typescript-mcp-server-generator for implementation code.
---

# MCP Tool Design & Evaluation

Design MCP tools that LLMs can discover, compose, and use reliably. For project scaffolding, SDK v2 patterns, and transport setup, use the `typescript-mcp-server-generator` skill.

## When to Use

- Choosing which API endpoints become tools vs higher-level workflows
- Naming tools, shaping inputs/outputs, and writing descriptions agents can act on
- Adding tool annotations (`readOnlyHint`, `destructiveHint`, etc.)
- Building evaluation suites to verify agents can solve real tasks with your tools

---

## Tool Design

### API Coverage vs Workflow Tools

Balance comprehensive API endpoint coverage with specialized workflow tools. Workflow tools are convenient for specific tasks; broad coverage lets agents compose operations. When uncertain, **prioritize comprehensive API coverage**.

### Naming and Discoverability

Use consistent, action-oriented prefixes (`github_create_issue`, `github_list_repos`). Names should make the tool's purpose obvious without reading the full description.

### Context Management

Return focused, relevant data. Support pagination and filtering where the backing API allows. Concise descriptions beat exhaustive parameter dumps.

### Error Messages

Errors should guide agents toward a fix — include what failed, why, and a concrete next step (retry with different params, call another tool first, etc.).

### Tool Annotations

Set hints so clients can surface appropriate UX:

- `readOnlyHint` — no side effects
- `destructiveHint` — irreversible or high-impact changes
- `idempotentHint` — safe to retry
- `openWorldHint` — interacts with external/unbounded data

### Planning Checklist

Before implementing, review the service API docs for endpoints, auth, and data models. List tools to implement starting with the most common read operations, then writes.

---

## Evaluation Suite

After tools are implemented, verify agents can use them effectively.

**Load [Evaluation Guide](./reference/evaluation.md) for the full process and runner scripts.**

### Purpose

Evaluations test whether an LLM can answer realistic, complex questions using only your MCP tools.

### Process

1. **Tool inspection** — list available tools and understand capabilities
2. **Content exploration** — use read-only operations to explore real data
3. **Question generation** — write 10 complex, realistic questions
4. **Answer verification** — solve each question yourself before adding it

### Requirements

Each question must be:

- **Independent** — not dependent on other questions
- **Read-only** — only non-destructive operations required
- **Complex** — multiple tool calls and exploration
- **Realistic** — based on real use cases
- **Verifiable** — single clear answer, string-comparable
- **Stable** — answer won't change over time

### Output Format

```xml
<evaluation>
  <qa_pair>
    <question>…</question>
    <answer>…</answer>
  </qa_pair>
</evaluation>
```

### Running Evaluations

Use `scripts/evaluation.py` and `scripts/connections.py` (see `scripts/requirements.txt`). Example XML: `scripts/example_evaluation.xml`.
