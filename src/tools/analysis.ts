import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { AskellClient } from '../client/askell-client.ts';

/** Minimal shape of the handler `ctx` param needed here — avoids depending on the SDK's internal context type name. */
type ToolContext = { mcpReq: { signal: AbortSignal } };

async function safeRequest(
  client: AskellClient,
  request: Parameters<AskellClient['request']>[0],
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const response = await client.request(request);
    const parsed = JSON.parse(response.text) as { body?: unknown };
    return {
      ok: response.ok,
      data: parsed.body ?? parsed,
      error: response.ok ? undefined : response.text,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export function registerAnalysisTools(
  server: McpServer,
  client: AskellClient,
): void {
  server.registerTool(
    'askell_paginate_all',
    {
      title: 'Paginate Askell list endpoint',
      description:
        'Fetch all pages from a paginated Askell list endpoint (v1/v2). Follows `next` links until exhausted or maxPages is reached. Large results are summarized to fit responseMaxBytes — check meta.truncatedByMaxBytes and meta.compacted in the response.',
      inputSchema: z.object({
        path: z.string().describe('List endpoint path, e.g. /subscriptions/'),
        query: z.record(z.string(), z.unknown()).optional(),
        apiKeyKind: z.enum(['secret', 'public']).default('secret'),
        maxPages: z.int().positive().max(100).default(20),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (input, ctx: ToolContext): Promise<CallToolResult> => {
      try {
        const response = await client.paginateAll({
          ...input,
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: 'text', text: response.text }],
          isError: !response.ok,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Pagination failed',
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'askell_customer_overview',
    {
      title: 'Customer overview (v1)',
      description:
        'Fetch a v1 customer and their v1 subscriptions in one call. Useful for support and billing investigations.',
      inputSchema: z.object({
        customerReference: z
          .string()
          .describe('Customer reference from Askell'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ customerReference }, ctx: ToolContext): Promise<CallToolResult> => {
      const [customer, subscriptions] = await Promise.all([
        safeRequest(client, {
          method: 'GET',
          path: `/customers/${encodeURIComponent(customerReference)}/`,
          signal: ctx.mcpReq.signal,
        }),
        safeRequest(client, {
          method: 'GET',
          path: `/customers/${encodeURIComponent(customerReference)}/subscriptions/`,
          signal: ctx.mcpReq.signal,
        }),
      ]);

      const payload = {
        customerReference,
        customer,
        subscriptions,
      };

      const notFoundHint =
        !customer.ok && !subscriptions.ok
          ? ' Verify the customerReference with askell_call GET /customers/ or askell_paginate_all.'
          : '';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2) + notFoundHint,
          },
        ],
        isError: !customer.ok && !subscriptions.ok,
      };
    },
  );

  server.registerTool(
    'askell_contract_overview',
    {
      title: 'Subscription contract overview (v2)',
      description:
        'Fetch a v2 subscription contract and recent billing runs filtered by contract id.',
      inputSchema: z.object({
        contractId: z.union([z.string(), z.number()]),
        billingRunLimit: z.int().positive().max(50).default(10),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (
      { contractId, billingRunLimit },
      ctx: ToolContext,
    ): Promise<CallToolResult> => {
      const contractPath = `/v2/subscription-contracts/${encodeURIComponent(String(contractId))}/`;

      const [contract, billingRuns] = await Promise.all([
        safeRequest(client, {
          method: 'GET',
          path: contractPath,
          signal: ctx.mcpReq.signal,
        }),
        safeRequest(client, {
          method: 'GET',
          path: '/v2/billing-runs/',
          query: {
            contract: contractId,
            page_size: billingRunLimit,
          },
          signal: ctx.mcpReq.signal,
        }),
      ]);

      const payload = {
        contractId,
        contract,
        billingRuns,
      };

      return {
        content: [
          {
            type: 'text',
            text:
              JSON.stringify(payload, null, 2) +
              (!contract.ok
                ? ' Verify the contractId with askell_call GET /v2/subscription-contracts/.'
                : ''),
          },
        ],
        isError: !contract.ok,
      };
    },
  );

  server.registerTool(
    'askell_billing_run_triage',
    {
      title: 'Billing run triage (v2)',
      description:
        'Fetch a billing run by id with optional related contract context for failure analysis.',
      inputSchema: z.object({
        billingRunId: z.union([z.string(), z.number()]),
        includeContract: z.boolean().default(true),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (
      { billingRunId, includeContract },
      ctx: ToolContext,
    ): Promise<CallToolResult> => {
      const billingRun = await safeRequest(client, {
        method: 'GET',
        path: `/v2/billing-runs/${encodeURIComponent(String(billingRunId))}/`,
        signal: ctx.mcpReq.signal,
      });

      let contract: Awaited<ReturnType<typeof safeRequest>> | undefined;

      if (includeContract && billingRun.ok && billingRun.data) {
        const run = billingRun.data as {
          contract?: string | number;
          contract_id?: string | number;
        };
        const contractId = run.contract ?? run.contract_id;

        if (contractId != null) {
          contract = await safeRequest(client, {
            method: 'GET',
            path: `/v2/subscription-contracts/${encodeURIComponent(String(contractId))}/`,
            signal: ctx.mcpReq.signal,
          });
        }
      }

      const payload = {
        billingRunId,
        billingRun,
        contract,
      };

      return {
        content: [
          {
            type: 'text',
            text:
              JSON.stringify(payload, null, 2) +
              (!billingRun.ok
                ? ' Verify the billingRunId with askell_call GET /v2/billing-runs/.'
                : ''),
          },
        ],
        isError: !billingRun.ok,
      };
    },
  );

  server.registerTool(
    'askell_list_webhooks',
    {
      title: 'List configured webhooks (v1)',
      description:
        'List Askell webhook endpoints configured for the account (management API only).',
      inputSchema: z.object({
        page_size: z.int().positive().max(1000).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (input, ctx: ToolContext): Promise<CallToolResult> => {
      const response = await safeRequest(client, {
        method: 'GET',
        path: '/webhooks/',
        query: input,
        signal: ctx.mcpReq.signal,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: !response.ok,
      };
    },
  );
}
