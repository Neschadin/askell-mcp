import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { AskellClient } from '../client/askell-client.ts';
import { isRecord } from '../is-record.ts';
import { resolveCallApiKeyKind } from './call.ts';

/** Minimal shape of the handler `ctx` param needed here — avoids depending on the SDK's internal context type name. */
type ToolContext = { mcpReq: { signal: AbortSignal } };

type SafeResult = { ok: boolean; data: unknown; error?: string };

const ERROR_DETAIL_MAX = 200;

const READ_ONLY_OPEN_WORLD_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= ERROR_DETAIL_MAX) return oneLine;

  return `${oneLine.slice(0, ERROR_DETAIL_MAX - 1)}…`;
}

function messageList(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = clip(value);
    return text.length > 0 ? text : undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    return undefined;
  }
  const text = clip(value.filter((item) => item.trim().length > 0).join('; '));
  return text.length > 0 ? text : undefined;
}

/**
 * One line for the model. The Askell body stays in `data`.
 * Supports Askell `{ error, code }` envelopes, DRF `detail` / `non_field_errors`,
 * and flat or nested field validation errors (e.g. `PlanUpdate.payment_processor`),
 * while refusing to flatten a resource object into the summary.
 */
export function summarizeApiFailure(status: number, body: unknown): string {
  const detail = apiErrorDetail(body);
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

function extractFieldErrors(
  record: Record<string, unknown>,
  prefix = '',
): string[] | undefined {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (prefix === '' && (key === 'detail' || key === 'non_field_errors')) {
      continue;
    }

    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) {
      const nested = extractFieldErrors(value, pathKey);
      if (!nested || nested.length === 0) {
        return undefined;
      }
      parts.push(...nested);
      continue;
    }

    const text = messageList(value);
    if (!text) {
      return undefined;
    }
    parts.push(`${pathKey}: ${text}`);
  }

  return parts.length > 0 ? parts : undefined;
}

function apiErrorDetail(body: unknown): string | undefined {
  if (typeof body === 'string') return messageList(body);
  if (!isRecord(body)) return undefined;

  if (typeof body.error === 'string') {
    const message = messageList(body.error);
    if (message) {
      const code =
        typeof body.code === 'string' && body.code.length > 0
          ? `[${body.code}] `
          : '';
      return clip(`${code}${message}`);
    }
  }

  if ('detail' in body) {
    const detail = messageList(body.detail);
    if (detail) return detail;
  }

  if ('non_field_errors' in body) {
    const detail = messageList(body.non_field_errors);
    if (detail) return detail;
  }

  const fieldParts = extractFieldErrors(body);
  return fieldParts ? clip(fieldParts.join('; ')) : undefined;
}

async function safeRequest(
  client: AskellClient,
  request: Parameters<AskellClient['request']>[0],
): Promise<SafeResult> {
  try {
    const response = await client.request(request);
    const parsed = JSON.parse(response.text) as { body?: unknown };
    const data = parsed.body ?? parsed;
    if (response.ok) return { ok: true, data };

    return {
      ok: false,
      data,
      error: summarizeApiFailure(response.status, data),
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

function failedCalls(
  calls: Array<[name: string, result: SafeResult]>,
): string[] | undefined {
  const names = calls.filter(([, result]) => !result.ok).map(([name]) => name);
  return names.length > 0 ? names : undefined;
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
        'Fetch all pages from a paginated Askell list endpoint (v1/v2). Pass `page_size` in `query` (e.g. `{ page_size: 100 }`) to enable server-side pagination; follows `next` links until exhausted or `maxPages` is reached. When the full payload exceeds responseMaxBytes, items are compacted (summary, then an index) so rows are kept — dropping rows is last resort. Check `meta.truncatedByMaxBytes`, `meta.compacted`, and `meta.compactedMode`.',
      inputSchema: z.object({
        path: z.string().describe('List endpoint path, e.g. /subscriptions/ or /v2/claim-rules/'),
        query: z
          .record(z.string(), z.json())
          .optional()
          .describe('Query string parameters forwarded to the list endpoint (include page_size to paginate)'),
        apiKeyKind: z
          .enum(['secret', 'public', 'none'])
          .optional()
          .describe(
            'Which configured API key to use. Omit to follow the OpenAPI operation (none sends no Authorization header)',
          ),
        maxPages: z
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe('Stop after this many pages (default 20, max 100)'),
      }),
      annotations: READ_ONLY_OPEN_WORLD_ANNOTATIONS,
    },
    async (input, ctx: ToolContext): Promise<CallToolResult> => {
      try {
        const response = await client.paginateAll({
          ...input,
          apiKeyKind: resolveCallApiKeyKind('GET', input.path, input.apiKeyKind),
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
              text:
                error instanceof Error ? error.message : 'Pagination failed',
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
      title: 'Customer overview (v1 + optional v2 contracts)',
      description:
        'Fetch a customer (`GET /customers/{ref}/`) and their v1 subscriptions in one call, plus optional v2 subscription contracts (`includeV2Contracts: true`). Useful for support and billing investigations across legacy, dual, and migrated accounts. Result is an error when the customer fetch fails; subscriptions/contracts are still included. `failures` lists every call that failed.',
      inputSchema: z.object({
        customerReference: z
          .string()
          .describe('Customer reference from Askell'),
        includeV2Contracts: z
          .boolean()
          .default(false)
          .describe(
            'Also fetch V2 subscription contracts for this customer_reference (GET /v2/subscription-contracts/)',
          ),
      }),
      annotations: READ_ONLY_OPEN_WORLD_ANNOTATIONS,
    },
    async (
      { customerReference, includeV2Contracts },
      ctx: ToolContext,
    ): Promise<CallToolResult> => {
      const encodedRef = encodeURIComponent(customerReference);
      const [customer, subscriptions, contracts] = await Promise.all([
        safeRequest(client, {
          method: 'GET',
          path: `/customers/${encodedRef}/`,
          signal: ctx.mcpReq.signal,
        }),
        safeRequest(client, {
          method: 'GET',
          path: `/customers/${encodedRef}/subscriptions/`,
          signal: ctx.mcpReq.signal,
        }),
        includeV2Contracts
          ? safeRequest(client, {
              method: 'GET',
              path: '/v2/subscription-contracts/',
              query: { customer_reference: customerReference, page_size: 20 },
              signal: ctx.mcpReq.signal,
            })
          : Promise.resolve(undefined),
      ]);

      const calls: Array<[string, SafeResult]> = [
        ['customer', customer],
        ['subscriptions', subscriptions],
      ];
      if (contracts) {
        calls.push(['contracts', contracts]);
      }
      const failures = failedCalls(calls);

      const payload = {
        customerReference,
        customer,
        subscriptions,
        ...(contracts ? { contracts } : {}),
        ...(failures ? { failures } : {}),
        ...(!customer.ok
          ? {
              hint: 'Verify the customerReference with askell_call GET /customers/ or askell_paginate_all.',
            }
          : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: !customer.ok,
      };
    },
  );

  server.registerTool(
    'askell_contract_overview',
    {
      title: 'Subscription contract overview (v2)',
      description:
        'Fetch a v2 subscription contract and recent billing runs filtered by contract id. The contract payload includes `service_entitlement_policy` (`on_run_created` | `on_run_succeeded`), `discount` (active coupon) when one is applied, `shipping_selection` when shipping was chosen at checkout, `subscriber_page` (customer-facing management URL, read-only; not a seller-verified portal link), `sales_channel` / `sales_channel_id`, `reference`, `scheduled_changes`, `pending_delivery_change` (queued address or shipping change, null if none), `one_off_purchases` (pending only — billed, canceled, and failed are GET /v2/subscription-contracts/{id}/one-off-purchases/), and per-item `scheduled_change` / `pending_interval_change` / `pending_change` (status `awaiting_payment` while a change waits for its charge). Billing runs collected by bank claim (`krafa`) expose `claim` (`transaction_id` is null while `pending_external`). Result is an error when the contract fetch fails. `failures` lists every call that failed.',
      inputSchema: z.object({
        contractId: z
          .union([z.string().min(1), z.int()])
          .describe('V2 subscription contract id'),
        billingRunLimit: z
          .int()
          .positive()
          .max(50)
          .default(10)
          .describe('Max billing runs to include (page_size)'),
      }),
      annotations: READ_ONLY_OPEN_WORLD_ANNOTATIONS,
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

      const failures = failedCalls([
        ['contract', contract],
        ['billingRuns', billingRuns],
      ]);

      const payload = {
        contractId,
        contract,
        billingRuns,
        ...(failures ? { failures } : {}),
        ...(!contract.ok
          ? {
              hint: 'Verify the contractId with askell_call GET /v2/subscription-contracts/.',
            }
          : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: !contract.ok,
      };
    },
  );

  server.registerTool(
    'askell_billing_run_triage',
    {
      title: 'Billing run triage (v2)',
      description:
        'Fetch a billing run by id with optional related contract context for failure analysis. Result is an error when the billing run fetch fails. A failed related contract stays in the payload and is listed in `failures`. A `pending_external` run waiting on a bank claim (`krafa`) exposes `claim` (`state: sent_to_bank`, `status: unpaid`; `transaction_id` is null until paid) — manage with `POST /v2/billing-runs/{id}/cancel-claim/` or `change-claim/`. A succeeded run can still be partly refunded: read `refunded_amount` and `refundable_amount` (`refundable_amount` is `0.00` unless state is `succeeded`).',
      inputSchema: z.object({
        billingRunId: z
          .union([z.string().min(1), z.int()])
          .describe('V2 billing run id'),
        includeContract: z
          .boolean()
          .default(true)
          .describe(
            'Also fetch the related subscription contract when the run has a contract id',
          ),
      }),
      annotations: READ_ONLY_OPEN_WORLD_ANNOTATIONS,
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

      const calls: [string, SafeResult][] = [['billingRun', billingRun]];
      if (contract) {
        calls.push(['contract', contract]);
      }
      const failures = failedCalls(calls);

      const payload = {
        billingRunId,
        billingRun,
        contract,
        ...(failures ? { failures } : {}),
        ...(!billingRun.ok
          ? {
              hint: 'Verify the billingRunId with askell_call GET /v2/billing-runs/.',
            }
          : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: !billingRun.ok,
      };
    },
  );

  server.registerTool(
    'askell_list_webhooks',
    {
      title: 'List configured webhooks (v1)',
      description:
        'List Askell webhook endpoints configured for the account (management API only). hmac_secret is redacted in the tool output (`<redacted len=N>`); copy the real secret from the dashboard or a non-MCP API call.',
      inputSchema: z.object({
        page_size: z
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe(
            'Page size for GET /webhooks/ (Askell default 10, max 1000)',
          ),
      }),
      annotations: READ_ONLY_OPEN_WORLD_ANNOTATIONS,
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
