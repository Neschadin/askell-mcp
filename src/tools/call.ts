import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
} from '@modelcontextprotocol/server';
import * as z from 'zod';

import { AskellClient, type AskellRequest } from '../client/askell-client.ts';
import { normalizeApiPath } from '../client/paths.ts';
import type { AppConfig } from '../config.ts';
import { operationRegistry } from '../openapi/registry.ts';
import {
  clientSupportsFormElicitation,
  decideMutationGate,
  readClientCapabilities,
} from './mutation-gate.ts';

const confirmationSchema = z.object({
  confirm: z.boolean().meta({ title: 'Confirm mutating Askell API request' }),
});

const sharedCallFields = {
  path: z
    .string()
    .describe('API path relative to apiBaseUrl, e.g. /v2/subscription-contracts/'),
  query: z
    .record(z.string(), z.json())
    .optional()
    .describe('Query string parameters'),
  body: z.json().optional().describe('JSON request body'),
  apiKeyKind: z
    .enum(['secret', 'public'])
    .default('secret')
    .describe('Which configured API key to use'),
};

const callInputSchema = z.object({
  method: z.enum(['GET', 'HEAD']).describe('HTTP method (read-only)'),
  ...sharedCallFields,
});

const mutateInputSchema = z.object({
  method: z
    .enum(['POST', 'PUT', 'PATCH', 'DELETE'])
    .describe('HTTP method (mutating)'),
  ...sharedCallFields,
});

type CallInput = z.infer<typeof callInputSchema>;
type MutateInput = z.infer<typeof mutateInputSchema>;

type ToolCtx = {
  mcpReq: {
    signal: AbortSignal;
    envelope?: unknown;
    inputResponses?: Record<string, unknown>;
  };
};

function buildApprovalMessage(input: MutateInput): string {
  const lines = [
    'Approve this Askell API request?',
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

async function executeAskellRequest(
  client: AskellClient,
  input: CallInput | MutateInput,
  signal: AbortSignal,
): Promise<CallToolResult> {
  const path = normalizeApiPath(input.path);
  const known = operationRegistry
    .find({
      method: input.method,
      pathPrefix: path,
    })
    .find((operation) => operation.path === path);

  const request: AskellRequest = {
    method: input.method,
    path,
    query: input.query,
    body: input.body,
    apiKeyKind: input.apiKeyKind ?? known?.apiKeyKind ?? 'secret',
    signal,
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
}

function mutationConfirmation(
  config: AppConfig,
  input: MutateInput,
  ctx: ToolCtx,
): CallToolResult | InputRequiredResult | undefined {
  const declined = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
  if (
    declined.kind === 'elicit' &&
    (declined.action === 'decline' || declined.action === 'cancel')
  ) {
    return {
      content: [{ type: 'text', text: 'Mutation cancelled by operator.' }],
      isError: true,
    };
  }

  const confirmed = acceptedContent(
    ctx.mcpReq.inputResponses,
    'confirm',
    confirmationSchema,
  );

  const decision = decideMutationGate({
    gate: config.mutationGate,
    alreadyConfirmed: confirmed?.confirm === true,
    supportsFormElicitation: clientSupportsFormElicitation(
      readClientCapabilities(ctx.mcpReq.envelope),
    ),
  });

  if (decision.action === 'execute') {
    return undefined;
  }

  return inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({
        message: buildApprovalMessage(input),
        requestedSchema: confirmationSchema,
      }),
    },
  });
}

export function registerCallTools(
  server: McpServer,
  client: AskellClient,
  config: AppConfig,
): void {
  server.registerTool(
    'askell_call',
    {
      title: 'Call Askell API (read)',
      description:
        'Read-only Askell API call (GET, HEAD) for any v1/v2 path. For POST/PUT/PATCH/DELETE use askell_mutate. Discover paths with askell_list_operations and askell_describe_operation first.',
      inputSchema: callInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input, ctx): Promise<CallToolResult> => {
      return executeAskellRequest(client, input, ctx.mcpReq.signal);
    },
  );

  server.registerTool(
    'askell_mutate',
    {
      title: 'Mutate Askell API',
      description:
        'Mutating Askell API call (POST, PUT, PATCH, DELETE). Clients that declared form elicitation get a confirmation form; others rely on the client tool-approval UI. Use askell_call for GET. Discover paths with askell_list_operations and askell_describe_operation first.',
      inputSchema: mutateInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, ctx): Promise<CallToolResult | InputRequiredResult> => {
      const gated = mutationConfirmation(config, input, ctx);
      if (gated) {
        return gated;
      }
      return executeAskellRequest(client, input, ctx.mcpReq.signal);
    },
  );
}
