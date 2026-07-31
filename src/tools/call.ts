import {
  acceptedContent,
  inputRequired,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
} from '@modelcontextprotocol/server';
import * as z from 'zod';

import { AskellClient, type AskellRequest } from '../client/askell-client.ts';
import { normalizeApiPath } from '../client/paths.ts';
import { isMutatingMethod } from '../client/response-formatter.ts';
import type { AppConfig } from '../config.ts';
import { operationRegistry } from '../openapi/registry.ts';

const confirmationSchema = z.object({
  confirm: z.boolean().meta({ title: 'Confirm mutating Askell API request' }),
});

const callInputSchema = z.object({
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .describe('HTTP method'),
  path: z
    .string()
    .describe('API path relative to apiBaseUrl, e.g. /v2/subscription-contracts/'),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Query string parameters'),
  body: z.unknown().optional().describe('JSON request body'),
  apiKeyKind: z
    .enum(['secret', 'public'])
    .default('secret')
    .describe('Which configured API key to use'),
});

function buildApprovalMessage(input: z.infer<typeof callInputSchema>): string {
  const lines = [
    `Approve this Askell API request?`,
    '',
    `${input.method} ${input.path}`,
    `apiKeyKind: ${input.apiKeyKind}`,
  ];

  if (input.query && Object.keys(input.query).length > 0) {
    lines.push('', 'Query:', JSON.stringify(input.query, null, 2));
  }

  if (input.body !== undefined) {
    lines.push('', 'Body:', JSON.stringify(input.body, null, 2));
  }

  return lines.join('\n');
}

export function registerCallTool(
  server: McpServer,
  client: AskellClient,
  config: AppConfig,
): void {
  server.registerTool(
    'askell_call',
    {
      title: 'Call Askell API',
      description:
        'Execute any Askell API endpoint (v1 or v2). Mutating requests require operator approval when requireMutationApproval is enabled. Use askell_list_operations and askell_describe_operation first to discover paths and parameters.',
      inputSchema: callInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, ctx): Promise<CallToolResult | InputRequiredResult> => {
      const mutating = isMutatingMethod(input.method);

      if (config.requireMutationApproval && mutating) {
        const confirmed = acceptedContent(
          ctx.mcpReq.inputResponses,
          'confirm',
          confirmationSchema,
        );

        if (confirmed?.confirm !== true) {
          return inputRequired({
            inputRequests: {
              confirm: inputRequired.elicit({
                message: buildApprovalMessage(input),
                requestedSchema: confirmationSchema,
              }),
            },
          });
        }
      }

      const path = normalizeApiPath(input.path);
      const known = operationRegistry.find({
        method: input.method,
        pathPrefix: path,
      }).find((operation) => operation.path === path);

      const request: AskellRequest = {
        method: input.method,
        path,
        query: input.query,
        body: input.body,
        apiKeyKind: input.apiKeyKind ?? known?.apiKeyKind ?? 'secret',
        signal: ctx.mcpReq.signal,
      };

      try {
        const response = await client.request(request);
        return {
          content: [{ type: 'text', text: response.text }],
          isError: !response.ok,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Askell API error';
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    },
  );
}
