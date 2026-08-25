#!/usr/bin/env bun
/**
 * Deterministic evaluation.xml runner: drives askell-mcp over stdio (no LLM).
 *
 * Q9–Q10 hit the live account and can drift; everything else is spec/discovery.
 */

import { spawn, type Subprocess } from 'bun';

type JsonRpcResponse = {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    contents?: Array<{ text?: string }>;
    serverInfo?: { name?: string };
  };
  error?: { message?: string };
};

type QaPair = { question: string; expected: string };

type Solver = {
  match: RegExp;
  live?: boolean;
  solve: (session: McpSession) => Promise<string>;
};

async function readJsonRpcLine(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const newline = buffer.indexOf('\n');
    if (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      reader.releaseLock();
      return JSON.parse(line);
    }
  }

  reader.releaseLock();
  throw new Error(`no JSON-RPC line (buffer=${buffer.slice(0, 200)})`);
}

class McpSession {
  private nextId = 1;

  constructor(private readonly proc: Subprocess<'pipe', 'pipe', 'pipe'>) {}

  async request(
    method: string,
    params: unknown = {},
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    this.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
    );
    return (await readJsonRpcLine(this.proc.stdout)) as JsonRpcResponse;
  }

  notify(method: string, params: unknown = {}): void {
    this.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  }

  async close(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
  }
}

async function callTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  text: string;
  isError: boolean;
  parsed?: unknown;
  structured?: unknown;
}> {
  const response = await session.request('tools/call', {
    name,
    arguments: args,
  });

  if (response.error) {
    throw new Error(`${name}: ${response.error.message ?? 'RPC error'}`);
  }

  const text = response.result?.content?.[0]?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  return {
    text,
    isError: response.result?.isError ?? false,
    parsed,
    structured: response.result?.structuredContent,
  };
}

function parseEvaluationXml(xml: string): QaPair[] {
  return [
    ...xml.matchAll(
      /<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>/g,
    ),
  ].map((match) => ({
    question: match[1]!.trim(),
    expected: match[2]!.trim(),
  }));
}

const PAGINATION_PARAMS = new Set([
  'page',
  'page_size',
  'cursor',
  'offset',
  'limit',
]);

function requiredBodyFields(schema: unknown): string[] {
  if (schema == null || typeof schema !== 'object') {
    return [];
  }

  const node = schema as { required?: unknown; allOf?: unknown[] };
  const fromRequired = Array.isArray(node.required)
    ? node.required.filter((value): value is string => typeof value === 'string')
    : [];
  const fromAllOf = Array.isArray(node.allOf)
    ? node.allOf.flatMap(requiredBodyFields)
    : [];

  return [...fromRequired, ...fromAllOf];
}

function planName(sub: Record<string, unknown>): string {
  const plan = sub.plan;
  if (typeof plan === 'string' || typeof plan === 'number') {
    return String(plan);
  }
  if (plan && typeof plan === 'object' && 'name' in plan) {
    return String((plan as { name: unknown }).name);
  }
  return String(sub.name ?? '');
}

function customerRef(sub: Record<string, unknown>): string {
  if (sub.customer_reference != null) {
    return String(sub.customer_reference);
  }
  const customer = sub.customer;
  if (customer && typeof customer === 'object') {
    const nested = customer as Record<string, unknown>;
    return String(
      nested.customer_reference ?? nested.reference ?? nested.id ?? '',
    );
  }
  return String(sub.customer ?? '');
}

function inRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso < end;
}

let subscriptionCache:
  | { items: Array<Record<string, unknown>>; truncated: boolean; itemCount: number }
  | undefined;

async function loadSubscriptions(session: McpSession): Promise<{
  items: Array<Record<string, unknown>>;
  truncated: boolean;
  itemCount: number;
}> {
  if (subscriptionCache) {
    return subscriptionCache;
  }

  const result = await callTool(session, 'askell_paginate_all', {
    path: '/subscriptions/',
    query: { type: 'light', page_size: 100 },
    maxPages: 100,
  });

  if (result.isError) {
    throw new Error(`askell_paginate_all failed: ${result.text.slice(0, 200)}`);
  }

  const parsed = result.parsed as {
    meta?: {
      itemCount?: number;
      returnedCount?: number;
      truncatedByMaxBytes?: boolean;
    };
    body?: unknown[];
  };
  const items = (parsed.body ?? []) as Array<Record<string, unknown>>;
  const itemCount = parsed.meta?.itemCount ?? items.length;
  const truncated =
    parsed.meta?.truncatedByMaxBytes === true ||
    items.length !== itemCount;

  subscriptionCache = { items, truncated, itemCount };
  return subscriptionCache;
}

const SOLVERS: Solver[] = [
  {
    match: /total number of API operations/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_list_operations', {
        apiVersion: 'all',
        limit: 200,
      });
      const payload = (result.structured ?? result.parsed) as {
        totalMatched?: number;
      };
      return String(payload.totalMatched ?? 'NOT_FOUND');
    },
  },
  {
    match: /require the public API key/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_list_operations', {
        apiVersion: 'all',
        apiKeyKind: 'public',
        limit: 200,
      });
      const payload = (result.structured ?? result.parsed) as {
        totalMatched?: number;
      };
      return String(payload.totalMatched ?? 'NOT_FOUND');
    },
  },
  {
    match: /Create a V2 subscription contract/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_list_operations', {
        apiVersion: 'v2',
        search: 'Create a V2 subscription contract',
        limit: 20,
      });
      const payload = (result.structured ?? result.parsed) as {
        operations?: Array<{ id: string; summary: string }>;
      };
      const hit = payload.operations?.find(
        (operation) => operation.summary === 'Create a V2 subscription contract',
      );
      return hit?.id ?? 'NOT_FOUND';
    },
  },
  {
    match: /retrying a billing run/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_describe_operation', {
        operationId: 'v2:POST:/v2/billing-runs/{billingRunId}/retry/',
      });
      if (result.isError) {
        throw new Error(result.text);
      }
      const payload = (result.structured ?? result.parsed) as {
        requestBody?: { schema?: unknown };
      };
      const required = requiredBodyFields(payload.requestBody?.schema);
      return required[0] ?? 'NOT_FOUND';
    },
  },
  {
    match: /OpenAPI tag is the Askell v1/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_describe_operation', {
        operationId: 'v1:GET:/hello/',
      });
      if (result.isError) {
        throw new Error(result.text);
      }
      const payload = (result.structured ?? result.parsed) as {
        tags?: string[];
      };
      return payload.tags?.[0] ?? 'NOT_FOUND';
    },
  },
  {
    match: /health-check endpoint/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_call', {
        method: 'GET',
        path: '/hello/',
      });
      if (result.isError) {
        throw new Error(result.text);
      }
      const parsed = result.parsed as { body?: { status?: string } };
      return parsed.body?.status ?? 'NOT_FOUND';
    },
  },
  {
    match: /HMAC using which hash algorithm/i,
    solve: async (session) => {
      const response = await session.request('resources/read', {
        uri: 'askell://docs/webhook-events',
      });
      if (response.error) {
        throw new Error(response.error.message ?? 'resources/read failed');
      }
      const text = response.result?.contents?.[0]?.text ?? '';
      const match = text.match(/SHA-?(\d+)/i);
      return match ? `SHA-${match[1]}` : 'NOT_FOUND';
    },
  },
  {
    match: /filtering by customer/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_describe_operation', {
        operationId: 'v2:GET:/v2/subscription-contracts/',
      });
      if (result.isError) {
        throw new Error(result.text);
      }
      const payload = (result.structured ?? result.parsed) as {
        parameters?: Array<{ name?: string; in?: string }>;
      };
      const names = (payload.parameters ?? [])
        .filter(
          (parameter) =>
            parameter.in === 'query' &&
            parameter.name &&
            !PAGINATION_PARAMS.has(parameter.name) &&
            /customer/i.test(parameter.name),
        )
        .map((parameter) => parameter.name!);
      return names.join(', ');
    },
  },
  {
    match: /distinct subscription plan names/i,
    live: true,
    solve: async (session) => {
      const { items, truncated, itemCount } = await loadSubscriptions(session);
      if (truncated) {
        throw new Error(
          `paginate_all truncated (${items.length}/${itemCount}); cannot score live date window`,
        );
      }
      const plans = new Set(
        items
          .filter((sub) =>
            inRange(
              String(sub.start_date ?? ''),
              '2026-07-01T00:00:00Z',
              '2026-08-01T00:00:00Z',
            ),
          )
          .map(planName)
          .filter(Boolean),
      );
      return String(plans.size);
    },
  },
  {
    match: /first-ever v1 subscription/i,
    live: true,
    solve: async (session) => {
      const { items, truncated, itemCount } = await loadSubscriptions(session);
      if (truncated) {
        throw new Error(
          `paginate_all truncated (${items.length}/${itemCount}); cannot score live date window`,
        );
      }

      const byCustomer = new Map<string, Record<string, unknown>[]>();
      for (const sub of items) {
        const ref = customerRef(sub);
        const group = byCustomer.get(ref) ?? [];
        group.push(sub);
        byCustomer.set(ref, group);
      }

      const counts = new Map<string, number>();
      for (const subs of byCustomer.values()) {
        const first = [...subs].sort((a, b) =>
          String(a.start_date ?? '').localeCompare(String(b.start_date ?? '')),
        )[0];
        if (!first) {
          continue;
        }
        if (
          !inRange(
            String(first.start_date ?? ''),
            '2026-04-10T00:00:00Z',
            '2026-07-11T00:00:00Z',
          )
        ) {
          continue;
        }
        const name = planName(first);
        if (!name) {
          continue;
        }
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }

      let best = 'NOT_FOUND';
      let bestCount = -1;
      for (const [name, count] of counts) {
        if (count > bestCount) {
          best = name;
          bestCount = count;
        }
      }
      return best;
    },
  },
  {
    match: /active coupon discount/i,
    solve: async (session) => {
      const result = await callTool(session, 'askell_list_operations', {
        apiVersion: 'v2',
        pathPrefix: '/v2/subscription-contracts/',
        search: 'discount',
        limit: 20,
      });
      const payload = (result.structured ?? result.parsed) as {
        operations?: Array<{ path: string; method: string; summary: string }>;
      };
      const hit = payload.operations?.find(
        (operation) =>
          operation.method === 'GET' &&
          operation.path.endsWith('/discount/') &&
          /discount/i.test(operation.summary),
      );
      return hit?.path ?? 'NOT_FOUND';
    },
  },
];

function findSolver(question: string): Solver {
  const hits = SOLVERS.filter((solver) => solver.match.test(question));
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one solver for question, got ${hits.length}: ${question.slice(0, 80)}`,
    );
  }
  return hits[0]!;
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const xmlPath = `${root}/evaluation.xml`;
  const pairs = parseEvaluationXml(await Bun.file(xmlPath).text());

  if (pairs.length === 0) {
    throw new Error(`no <qa_pair> in ${xmlPath}`);
  }

  const unmatched = SOLVERS.filter(
    (solver) => !pairs.some((pair) => solver.match.test(pair.question)),
  );
  if (unmatched.length > 0) {
    throw new Error(
      `solver(s) match no evaluation.xml question: ${unmatched.map((s) => s.match).join(', ')}`,
    );
  }

  const proc = spawn({
    cmd: ['bun', 'run', 'src/index.ts'],
    cwd: root,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env },
  });
  const session = new McpSession(proc);

  try {
    const init = await session.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'askell-eval-tools', version: '0.0.0' },
    });
    if (init.result?.serverInfo?.name !== 'askell-mcp') {
      throw new Error(
        `initialize failed: ${init.result?.serverInfo?.name ?? init.error?.message}`,
      );
    }
    session.notify('notifications/initialized');

    let passed = 0;
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index]!;
      const solver = findSolver(pair.question);
      const label = `Q${index + 1}${solver.live ? ' (live)' : ''}`;

      let actual: string;
      try {
        actual = await solver.solve(session);
      } catch (error) {
        actual = error instanceof Error ? error.message : String(error);
      }

      const ok = actual === pair.expected;
      if (ok) {
        passed += 1;
      }
      const tag = ok ? 'PASS' : 'FAIL';
      console.log(
        `${tag} ${label}: got=${JSON.stringify(actual)} expected=${JSON.stringify(pair.expected)}`,
      );
      if (!ok && solver.live) {
        console.log(
          `  note: live-account window; update evaluation.xml if the data drifted`,
        );
      }
    }

    console.log(`\n${passed}/${pairs.length} passed`);
    process.exit(passed === pairs.length ? 0 : 1);
  } finally {
    await session.close();
  }
}

await main();
