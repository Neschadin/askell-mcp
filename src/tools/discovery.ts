import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

import { operationRegistry } from '../openapi/registry.ts';

const listInputSchema = z.object({
  apiVersion: z
    .enum(['v1', 'v2', 'all'])
    .default('all')
    .describe('Filter by API version'),
  tag: z.string().optional().describe('Filter by OpenAPI tag'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .optional()
    .describe('Filter by HTTP method'),
  pathPrefix: z
    .string()
    .optional()
    .describe('Filter paths starting with this prefix, e.g. /v2/billing-runs/'),
  search: z
    .string()
    .optional()
    .describe(
      'Case-insensitive search in id, path, summary, description, tags',
    ),
  apiKeyKind: z
    .enum(['secret', 'public'])
    .optional()
    .describe('Filter by required API key type'),
  limit: z
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe('Maximum number of operations to return'),
});

const describeInputSchema = z.object({
  operationId: z
    .string()
    .describe(
      'Operation id from askell_list_operations, e.g. v2:GET:/v2/billing-runs/',
    ),
});

const apiVersionSchema = z.enum(['v1', 'v2']);
const apiKeyKindSchema = z.enum(['secret', 'public']);
const httpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
]);

const operationSummarySchema = z.object({
  id: z.string(),
  apiVersion: apiVersionSchema,
  method: httpMethodSchema,
  path: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
  apiKeyKind: apiKeyKindSchema,
  deprecated: z.boolean(),
});

const listOperationsOutputSchema = z.object({
  totalMatched: z.int(),
  returned: z.int(),
  availableTags: z.array(z.string()),
  operations: z.array(operationSummarySchema),
});

const openApiParameterSchema = z.object({
  name: z.string().optional(),
  in: z.enum(['query', 'path', 'header', 'cookie']).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: z.unknown().optional(),
  $ref: z.string().optional(),
});

const operationDetailSchema = z.object({
  id: z.string(),
  apiVersion: apiVersionSchema,
  method: httpMethodSchema,
  path: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
  description: z.string().optional(),
  parameters: z.array(openApiParameterSchema),
  requestBody: z
    .object({
      required: z.boolean().optional(),
      description: z.string().optional(),
      contentTypes: z.array(z.string()),
      schema: z.unknown().optional(),
    })
    .optional(),
  apiKeyKind: apiKeyKindSchema,
  deprecated: z.boolean().optional(),
});

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool(
    'askell_list_operations',
    {
      title: 'List Askell API operations',
      description:
        'Discover Askell v1 and v2 API operations from bundled OpenAPI specs. Returns operation ids usable with askell_describe_operation. NOTE: results are capped by `limit` (default 50) — always check `totalMatched` in the response, not just the length of `operations`, to know if more results exist.',
      inputSchema: listInputSchema,
      outputSchema: listOperationsOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (input): Promise<CallToolResult> => {
      const allMatches = operationRegistry.find(input);
      const matches = allMatches.slice(0, input.limit);

      const payload: z.infer<typeof listOperationsOutputSchema> = {
        totalMatched: allMatches.length,
        returned: matches.length,
        availableTags: operationRegistry.listTags(input.apiVersion),
        operations: matches.map((operation) => ({
          id: operation.id,
          apiVersion: operation.apiVersion,
          method: operation.method,
          path: operation.path,
          tags: operation.tags,
          summary: operation.summary,
          apiKeyKind: operation.apiKeyKind,
          deprecated: operation.deprecated ?? false,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'askell_describe_operation',
    {
      title: 'Describe Askell API operation',
      description:
        'Return full OpenAPI details for one operation: parameters, request body schema, auth requirements.',
      inputSchema: describeInputSchema,
      outputSchema: operationDetailSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ operationId }): Promise<CallToolResult> => {
      const operation = operationRegistry.getById(operationId);

      if (!operation) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown operationId: ${operationId}. Use askell_list_operations to discover valid ids.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(operation, null, 2) }],
        structuredContent: operation,
      };
    },
  );
}
