import { McpServer } from '@modelcontextprotocol/server';

import { AskellClient } from './client/askell-client.ts';
import type { AppConfig } from './config.ts';
import { registerResources } from './resources/register.ts';
import { registerAnalysisTools } from './tools/analysis.ts';
import { registerCallTool } from './tools/call.ts';
import { registerDiscoveryTools } from './tools/discovery.ts';

const SERVER_INSTRUCTIONS = `Askell MCP server for payment and subscription operations.

Workflow:
1. Use askell_list_operations and askell_describe_operation to discover endpoints, parameters, and auth requirements.
2. Prefer analysis tools (askell_customer_overview, askell_contract_overview, askell_billing_run_triage, askell_paginate_all, askell_list_webhooks) for common support tasks.
3. Use askell_call only when no dedicated tool covers the request.

API models:
- v1 (legacy): PlanVariant + Subscription at paths like /subscriptions/, /customers/. Still supported for existing integrations.
- v2 (current): Catalog, bundles, quotes, checkouts, subscription contracts, billing runs under /v2/. Prefer v2 for new integrations.
- Prose docs at https://docs.askell.is/api/ may describe flows (embedded checkout, 3D Secure, wallet passes) not fully listed in OpenAPI.

API layout:
- v1 paths have no prefix (e.g. /customers/, /subscriptions/, /webhooks/).
- v2 paths start with /v2/ (e.g. /v2/subscription-contracts/, /v2/billing-runs/).
- Askell paths use trailing slashes.
- V2 list endpoints paginate only when page_size is provided (default 10, max 1000).
- GET /v2/customer-entitlements/ requires customer_reference query param.

V2 checkout notes:
- checkout_url on V2 checkouts points to the API object URL, not a browser payment page.
- Embedded checkout uses POST /v2/checkout-sessions/ plus browser session-token sub-paths (see docs, not all in OpenAPI).

Auth:
- Most endpoints need the secret API key.
- Only temporary payment method and checkout status endpoints use the public key.

Safety:
- Mutating askell_call requests require operator approval when requireMutationApproval is enabled.
- Large list responses may be truncated or summarized to fit responseMaxBytes; check meta.truncatedByMaxBytes and meta.compacted.

Resources:
- askell://spec/v1 and askell://spec/v2 — bundled OpenAPI
- askell://docs/webhook-events — webhook event types including V2 subscription_contract.* and billing_run.*`;

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: 'askell-mcp',
      version: '0.1.0',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  const client = new AskellClient(config);

  registerDiscoveryTools(server);
  registerCallTool(server, client, config);
  registerAnalysisTools(server, client);
  registerResources(server);

  return server;
}
