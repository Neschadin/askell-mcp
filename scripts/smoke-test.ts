#!/usr/bin/env bun

import { spawn } from 'bun';

import { AskellClient } from '../src/client/askell-client.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import { operationRegistry } from '../src/openapi/registry.ts';
import { createServer } from '../src/server.ts';

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.error(`OK: ${message}`);
}

function buildConfigFromEnv(): AppConfig {
  const secretApiKey =
    Bun.env.ASKELL_PRIVATE_API_KEY ?? Bun.env.ASKELL_SECRET_API_KEY;
  const publicApiKey = Bun.env.ASKELL_PUBLIC_API_KEY;

  if (!secretApiKey) {
    fail(
      'Set ASKELL_PRIVATE_API_KEY (or ASKELL_SECRET_API_KEY) in .env or environment',
    );
  }

  return {
    apiBaseUrl:
      Bun.env.ASKELL_API_URL ??
      Bun.env.ASKELL_API_BASE_URL ??
      'https://askell.is/api',
    secretApiKey,
    publicApiKey,
    responseMaxBytes: 64_000,
    requireMutationApproval: true,
  };
}

async function testConfig(): Promise<AppConfig> {
  const expected = buildConfigFromEnv();
  const loaded = await loadConfig();

  if (loaded.secretApiKey !== expected.secretApiKey) {
    fail('loadConfig did not return the expected secretApiKey');
  }

  pass('config load from environment');
  return loaded;
}

function testRegistry(): void {
  const total = operationRegistry.operations.length;
  if (total < 50) {
    fail(`expected bundled operations, got ${total}`);
  }

  const hello = operationRegistry.getById('v1:GET:/hello/');
  if (!hello) {
    fail('missing v1:GET:/hello/ operation');
  }

  pass(`openapi registry (${total} operations)`);
}

function testServerFactory(config: AppConfig): void {
  const server = createServer(config);
  if (!server) {
    fail('createServer returned empty value');
  }

  pass('MCP server factory');
}

async function testLiveApi(config: AppConfig): Promise<void> {
  const client = new AskellClient(config);
  const response = await client.request({
    method: 'GET',
    path: '/hello/',
  });

  if (!response.ok) {
    fail(`GET /hello/ returned HTTP ${response.status}: ${response.text}`);
  }

  const payload = JSON.parse(response.text) as { body?: unknown };
  pass(`live API GET /hello/ (${response.status})`);

  if (payload.body == null) {
    fail('GET /hello/ response had no parsed body');
  }
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
  fail(`no JSON-RPC line received (buffer=${buffer.slice(0, 200)})`);
}

async function testStdioMcp(): Promise<void> {
  const proc = spawn({
    cmd: ['bun', 'run', 'src/index.ts'],
    cwd: `${import.meta.dir}/..`,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env },
  });

  const send = (message: unknown) => {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  };

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'askell-mcp-smoke', version: '0.0.0' },
    },
  });

  const initResponse = (await readJsonRpcLine(proc.stdout)) as {
    result?: { serverInfo?: { name?: string } };
    error?: { message?: string };
  };

  if (initResponse.error) {
    fail(`initialize failed: ${initResponse.error.message ?? 'unknown error'}`);
  }

  if (initResponse.result?.serverInfo?.name !== 'askell-mcp') {
    fail('initialize returned unexpected serverInfo');
  }

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const toolsResponse = (await readJsonRpcLine(proc.stdout)) as {
    result?: { tools?: Array<{ name: string }> };
    error?: { message?: string };
  };

  if (toolsResponse.error) {
    fail(
      `tools/list failed: ${toolsResponse.error.message ?? 'unknown error'}`,
    );
  }

  const toolNames = new Set(
    toolsResponse.result?.tools?.map((tool) => tool.name) ?? [],
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

  for (const name of expectedTools) {
    if (!toolNames.has(name)) {
      fail(`tools/list missing tool: ${name}`);
    }
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'askell_list_operations',
      arguments: { apiVersion: 'v1', limit: 2 },
    },
  });

  const callResponse = (await readJsonRpcLine(proc.stdout)) as {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message?: string };
  };

  if (callResponse.error) {
    fail(
      `tools/call askell_list_operations failed: ${callResponse.error.message ?? 'unknown error'}`,
    );
  }

  const text = callResponse.result?.content?.[0]?.text;
  if (!text?.includes('"operations"')) {
    fail('askell_list_operations returned unexpected payload');
  }

  proc.kill();
  await proc.exited;

  pass(`stdio MCP protocol (${toolNames.size} tools)`);
}

async function main(): Promise<void> {
  console.error('askell-mcp smoke test');

  const config = await testConfig();
  testRegistry();
  testServerFactory(config);
  await testLiveApi(config);
  await testStdioMcp();

  console.error('smoke test passed');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
