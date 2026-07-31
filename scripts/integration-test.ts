#!/usr/bin/env bun

import { spawn, type Subprocess } from 'bun';

import { AskellClient } from '../src/client/askell-client.ts';
import { loadConfig } from '../src/config.ts';

type JsonRpcResponse = {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    tools?: Array<{ name: string }>;
    resources?: Array<{ uri: string; name?: string }>;
    contents?: Array<{ uri: string; text?: string; mimeType?: string }>;
    serverInfo?: { name?: string };
    instructions?: string;
  };
  error?: { message?: string; code?: number };
};

const results: Array<{
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
}> = [];

function record(
  name: string,
  ok: boolean,
  detail?: string,
  skipped = false,
): void {
  results.push({ name, ok, detail, skipped });
  const label = skipped ? 'SKIP' : ok ? 'OK' : 'FAIL';
  console.error(`${label}: ${name}${detail ? ` — ${detail}` : ''}`);
}

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
  structuredContent?: unknown;
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
    structuredContent: response.result?.structuredContent,
  };
}

async function readResource(
  session: McpSession,
  uri: string,
): Promise<{ text: string; mimeType?: string }> {
  const response = await session.request('resources/read', { uri });

  if (response.error) {
    throw new Error(`resources/read ${uri}: ${response.error.message}`);
  }

  const content = response.result?.contents?.[0];
  return {
    text: content?.text ?? '',
    mimeType: content?.mimeType,
  };
}

async function discoverFixtures(client: AskellClient): Promise<{
  customerReference?: string;
  contractId?: number;
  billingRunId?: number;
}> {
  const customerRes = await client.request({
    method: 'GET',
    path: '/customers/',
    query: { page_size: 1 },
  });
  const customerParsed = JSON.parse(customerRes.text) as { body?: unknown };
  const customers = Array.isArray(customerParsed.body)
    ? customerParsed.body
    : customerParsed.body &&
        typeof customerParsed.body === 'object' &&
        'results' in customerParsed.body
      ? (
          customerParsed.body as {
            results: Array<{ customer_reference?: string }>;
          }
        ).results
      : [];
  const customerReference = customers[0]?.customer_reference;

  const contractRes = await client.request({
    method: 'GET',
    path: '/v2/subscription-contracts/',
    query: { page_size: 1 },
  });
  const contractParsed = JSON.parse(contractRes.text) as { body?: unknown };
  const contracts = Array.isArray(contractParsed.body)
    ? contractParsed.body
    : contractParsed.body &&
        typeof contractParsed.body === 'object' &&
        'results' in contractParsed.body
      ? (contractParsed.body as { results: Array<{ id?: number }> }).results
      : [];
  const contractId = contracts[0]?.id;

  const billingRes = await client.request({
    method: 'GET',
    path: '/v2/billing-runs/',
    query: { page_size: 1 },
  });
  const billingParsed = JSON.parse(billingRes.text) as { body?: unknown };
  const billingRuns = Array.isArray(billingParsed.body)
    ? billingParsed.body
    : billingParsed.body &&
        typeof billingParsed.body === 'object' &&
        'results' in billingParsed.body
      ? (billingParsed.body as { results: Array<{ id?: number }> }).results
      : [];
  const billingRunId = billingRuns[0]?.id;

  return { customerReference, contractId, billingRunId };
}

async function main(): Promise<void> {
  console.error('askell-mcp integration test');

  const config = await loadConfig();
  const client = new AskellClient(config);
  const fixtures = await discoverFixtures(client);

  const proc = spawn({
    cmd: ['bun', 'run', 'src/index.ts'],
    cwd: `${import.meta.dir}/..`,
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
      clientInfo: { name: 'askell-mcp-integration', version: '0.0.0' },
    });
    record(
      'initialize',
      init.result?.serverInfo?.name === 'askell-mcp' &&
        (init.result?.instructions?.includes('askell_list_operations') ??
          false),
      init.result?.serverInfo?.name,
    );
    session.notify('notifications/initialized');

    const toolsList = await session.request('tools/list', {});
    const toolNames = new Set(
      toolsList.result?.tools?.map((tool) => tool.name) ?? [],
    );
    const expectedTools = [
      'askell_list_operations',
      'askell_describe_operation',
      'askell_call',
      'askell_paginate_all',
      'askell_customer_overview',
      'askell_contract_overview',
      'askell_billing_run_triage',
      'askell_list_webhooks',
    ];
    const missingTools = expectedTools.filter((name) => !toolNames.has(name));
    record(
      'tools/list',
      missingTools.length === 0,
      missingTools.length
        ? `missing: ${missingTools.join(', ')}`
        : `${toolNames.size} tools`,
    );

    const resourcesList = await session.request('resources/list', {});
    const resourceUris = new Set(
      resourcesList.result?.resources?.map((resource) => resource.uri) ?? [],
    );
    const expectedResources = [
      'askell://spec/v1',
      'askell://spec/v2',
      'askell://docs/webhook-events',
    ];
    const missingResources = expectedResources.filter(
      (uri) => !resourceUris.has(uri),
    );
    record(
      'resources/list',
      missingResources.length === 0,
      missingResources.length
        ? `missing: ${missingResources.join(', ')}`
        : `${resourceUris.size} resources`,
    );

    // Discovery tools
    const listOps = await callTool(session, 'askell_list_operations', {
      apiVersion: 'v2',
      search: 'billing-runs',
      limit: 5,
    });
    const listOpsParsed = listOps.parsed as {
      operations?: unknown[];
      totalMatched?: number;
    };
    record(
      'tool:askell_list_operations',
      !listOps.isError &&
        Array.isArray(listOpsParsed?.operations) &&
        (listOpsParsed.operations?.length ?? 0) > 0 &&
        listOps.structuredContent != null,
      `matched=${listOpsParsed?.totalMatched}, structuredContent=${listOps.structuredContent != null}`,
    );

    const describe = await callTool(session, 'askell_describe_operation', {
      operationId: 'v1:GET:/hello/',
    });
    const describeParsed = describe.parsed as {
      path?: string;
      method?: string;
    };
    record(
      'tool:askell_describe_operation',
      !describe.isError &&
        describeParsed?.path === '/hello/' &&
        describeParsed?.method === 'GET' &&
        describe.structuredContent != null,
    );

    // askell_call GET
    const hello = await callTool(session, 'askell_call', {
      method: 'GET',
      path: '/hello/',
    });
    const helloParsed = hello.parsed as { status?: number; body?: unknown };
    record(
      'tool:askell_call (GET /hello/)',
      !hello.isError &&
        helloParsed?.status === 200 &&
        helloParsed?.body != null,
      `status=${helloParsed?.status}`,
    );

    // askell_call path normalization
    const helloNoSlash = await callTool(session, 'askell_call', {
      method: 'GET',
      path: '/hello',
    });
    const helloNoSlashParsed = helloNoSlash.parsed as { status?: number };
    record(
      'tool:askell_call (path normalization)',
      !helloNoSlash.isError && helloNoSlashParsed?.status === 200,
    );

    // askell_paginate_all — must return valid JSON
    const paginate = await callTool(session, 'askell_paginate_all', {
      path: '/subscriptions/',
      query: { page_size: 100, type: 'light' },
      maxPages: 3,
    });
    const paginateParsed = paginate.parsed as {
      meta?: { itemCount?: number; returnedCount?: number };
      body?: unknown[];
    };
    record(
      'tool:askell_paginate_all',
      !paginate.isError &&
        paginate.parsed != null &&
        Array.isArray(paginateParsed?.body) &&
        (paginateParsed.meta?.itemCount ?? 0) > 0,
      `items=${paginateParsed?.meta?.itemCount}, returned=${paginateParsed?.meta?.returnedCount}`,
    );

    // askell_list_webhooks
    const webhooks = await callTool(session, 'askell_list_webhooks', {
      page_size: 10,
    });
    const webhooksParsed = webhooks.parsed as { ok?: boolean; data?: unknown };
    record(
      'tool:askell_list_webhooks',
      !webhooks.isError && webhooks.parsed != null,
      `ok=${webhooksParsed?.ok}`,
    );

    // askell_customer_overview
    if (fixtures.customerReference) {
      const customer = await callTool(session, 'askell_customer_overview', {
        customerReference: fixtures.customerReference,
      });
      const customerParsed = customer.parsed as {
        customer?: { ok?: boolean };
        subscriptions?: { ok?: boolean };
      };
      record(
        'tool:askell_customer_overview',
        !customer.isError &&
          customerParsed?.customer?.ok === true &&
          customerParsed?.subscriptions?.ok === true,
        fixtures.customerReference,
      );
    } else {
      record('tool:askell_customer_overview', false, 'no fixture customer');
    }

    // askell_contract_overview
    if (fixtures.contractId != null) {
      const contract = await callTool(session, 'askell_contract_overview', {
        contractId: fixtures.contractId,
        billingRunLimit: 3,
      });
      const contractParsed = contract.parsed as {
        contract?: { ok?: boolean };
        billingRuns?: { ok?: boolean };
      };
      record(
        'tool:askell_contract_overview',
        !contract.isError && contractParsed?.contract?.ok === true,
        `contractId=${fixtures.contractId}`,
      );
    } else {
      record(
        'tool:askell_contract_overview',
        true,
        'account has no v2 subscription contracts',
        true,
      );
    }

    // askell_billing_run_triage
    if (fixtures.billingRunId != null) {
      const triage = await callTool(session, 'askell_billing_run_triage', {
        billingRunId: fixtures.billingRunId,
        includeContract: true,
      });
      const triageParsed = triage.parsed as {
        billingRun?: { ok?: boolean };
      };
      record(
        'tool:askell_billing_run_triage',
        !triage.isError && triageParsed?.billingRun?.ok === true,
        `billingRunId=${fixtures.billingRunId}`,
      );
    } else {
      record(
        'tool:askell_billing_run_triage',
        true,
        'account has no v2 billing runs',
        true,
      );
    }

    // Resources
    for (const uri of expectedResources) {
      try {
        const resource = await readResource(session, uri);
        let ok = resource.text.length > 0;
        if (uri.endsWith('/v1') || uri.endsWith('/v2')) {
          const spec = JSON.parse(resource.text) as { paths?: unknown };
          ok = ok && spec.paths != null;
        }
        if (uri.includes('webhook-events')) {
          ok = ok && resource.text.includes('Hook-HMAC');
        }
        record(`resource:${uri}`, ok, `${resource.text.length} chars`);
      } catch (error) {
        record(
          `resource:${uri}`,
          false,
          error instanceof Error ? error.message : 'read failed',
        );
      }
    }

    // askell_describe_operation unknown id
    const unknownOp = await callTool(session, 'askell_describe_operation', {
      operationId: 'v99:GET:/nope/',
    });
    record(
      'tool:askell_describe_operation (unknown id)',
      unknownOp.isError && unknownOp.text.includes('Unknown operationId'),
    );
  } finally {
    await session.close();
  }

  const failed = results.filter((result) => !result.ok && !result.skipped);
  const skipped = results.filter((result) => result.skipped);
  console.error('\n--- summary ---');
  console.error(
    `passed: ${results.length - failed.length - skipped.length}/${results.length} (${skipped.length} skipped)`,
  );
  if (failed.length > 0) {
    console.error('failed:');
    for (const item of failed) {
      console.error(`  - ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
    }
    process.exit(1);
  }

  console.error('integration test passed');
}

main().catch((error) => {
  console.error(
    'integration test crashed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
