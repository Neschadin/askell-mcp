import { describe, expect, test } from 'bun:test';
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';

import type { AskellClient, AskellRequest } from '../client/askell-client.ts';
import { registerAnalysisTools, summarizeApiFailure } from './analysis.ts';

describe('summarizeApiFailure', () => {
  test('keeps DRF detail and drops the rest of the body', () => {
    expect(summarizeApiFailure(404, { detail: 'Not found.' })).toBe(
      'HTTP 404: Not found.',
    );
  });

  test('summarizes flat field errors', () => {
    expect(
      summarizeApiFailure(400, { reference: ['This field is required.'] }),
    ).toBe('HTTP 400: reference: This field is required.');
  });

  test('does not flatten a resource object', () => {
    expect(summarizeApiFailure(500, { id: 1, customer: { id: 2 } })).toBe(
      'HTTP 500',
    );
  });
});

type Route = { status: number; body: unknown } | Error;

function fakeClient(routes: Record<string, Route>): AskellClient {
  return {
    async request(input: AskellRequest) {
      const route = routes[`${input.method} ${input.path}`];
      if (!route) {
        throw new Error(`unmapped ${input.method} ${input.path}`);
      }
      if (route instanceof Error) {
        throw route;
      }
      return {
        text: JSON.stringify({ status: route.status, body: route.body }),
        truncated: false,
        byteLength: 1,
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
      };
    },
  } as AskellClient;
}

async function callTool(
  client: AskellClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: Record<string, unknown>; text: string }> {
  const server = new McpServer({ name: 'askell-mcp-test', version: '0.0.0' });
  registerAnalysisTools(server, client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const response = await new Promise<JSONRPCMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tools/call timed out')), 2000);
    clientTransport.onmessage = (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'id' in message &&
        message.id === 1
      ) {
        clearTimeout(timer);
        resolve(message);
      }
    };
    void clientTransport.start().then(() =>
      clientTransport.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    );
  });

  await server.close();

  if (!('result' in response) || response.result == null) {
    throw new Error(`expected tool result, got ${JSON.stringify(response)}`);
  }

  const result = response.result as {
    isError?: boolean;
    content?: Array<{ text?: string }>;
  };
  const text = result.content?.[0]?.text ?? '';
  return {
    isError: result.isError === true,
    body: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}

describe('analysis tool errors', () => {
  test('customer overview is an error when the customer fetch fails', async () => {
    const result = await callTool(
      fakeClient({
        'GET /customers/cust_1/': {
          status: 404,
          body: { detail: 'Not found.' },
        },
        'GET /customers/cust_1/subscriptions/': {
          status: 200,
          body: [{ id: 7 }],
        },
      }),
      'askell_customer_overview',
      { customerReference: 'cust_1' },
    );

    expect(result.isError).toBe(true);
    expect(result.body.failures).toEqual(['customer']);
    expect(result.body.hint).toBe(
      'Verify the customerReference with askell_call GET /customers/ or askell_paginate_all.',
    );
    expect(result.body.customer).toEqual({
      ok: false,
      data: { detail: 'Not found.' },
      error: 'HTTP 404: Not found.',
    });
    expect(result.body.subscriptions).toEqual({
      ok: true,
      data: [{ id: 7 }],
    });
    expect(result.text).not.toContain('"headers"');
  });

  test('subscription failure stays a successful tool result', async () => {
    const result = await callTool(
      fakeClient({
        'GET /customers/cust_1/': { status: 200, body: { reference: 'cust_1' } },
        'GET /customers/cust_1/subscriptions/': {
          status: 500,
          body: { detail: 'boom' },
        },
      }),
      'askell_customer_overview',
      { customerReference: 'cust_1' },
    );

    expect(result.isError).toBe(false);
    expect(result.body.failures).toEqual(['subscriptions']);
    expect(result.body.hint).toBeUndefined();
  });

  test('billing triage lists a failed contract without failing the tool', async () => {
    const result = await callTool(
      fakeClient({
        'GET /v2/billing-runs/42/': {
          status: 200,
          body: { id: 42, contract: 9 },
        },
        'GET /v2/subscription-contracts/9/': {
          status: 404,
          body: { detail: 'Not found.' },
        },
      }),
      'askell_billing_run_triage',
      { billingRunId: 42, includeContract: true },
    );

    expect(result.isError).toBe(false);
    expect(result.body.failures).toEqual(['contract']);
    expect(result.body.contract).toMatchObject({
      ok: false,
      error: 'HTTP 404: Not found.',
    });
  });

  test('a thrown request becomes a short error and valid JSON', async () => {
    const result = await callTool(
      fakeClient({
        'GET /webhooks/': new Error('secretApiKey is not configured'),
      }),
      'askell_list_webhooks',
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.body).toEqual({
      ok: false,
      data: null,
      error: 'secretApiKey is not configured',
    });
  });
});
