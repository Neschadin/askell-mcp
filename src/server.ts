import { McpServer } from '@modelcontextprotocol/server';

import { AskellClient } from './client/askell-client.ts';
import {
  PRODUCTION_API_BASE_URL,
  SANDBOX_API_BASE_URL,
  normalizeBaseUrl,
  type AppConfig,
} from './config.ts';
import { registerResources } from './resources/register.ts';
import { registerAnalysisTools } from './tools/analysis.ts';
import { registerCallTools } from './tools/call.ts';
import { registerDiscoveryTools } from './tools/discovery.ts';
import { PACKAGE_VERSION } from './version.ts';

export function buildServerInstructions(config: AppConfig): string {
  const apiBase = normalizeBaseUrl(config.apiBaseUrl);
  const envLine =
    config.askellEnv === 'custom'
      ? `This instance: custom API base ${apiBase} (ASKELL_API_BASE_URL override)`
      : `This instance: ${config.askellEnv} (${apiBase})`;

  return `Askell MCP server for payment and subscription operations.

${envLine}
Official hosts (picked by ASKELL_ENV=production|sandbox; do not pass the URL):
- production: ${PRODUCTION_API_BASE_URL}
- sandbox (isolated tenant, separate API keys): ${SANDBOX_API_BASE_URL}
v1 and v2 share that base (v2 paths start with /v2/). Keys belong to one host — do not reuse production keys on sandbox or the reverse.
Áskell Test Gateway is a payment acquirer on either host, not a separate API host.
If both askell-prod and askell-sandbox MCP servers are connected, pick the instance whose environment matches the intended tenant.

Workflow:
1. Use askell_list_operations and askell_describe_operation to discover endpoints, parameters, and auth requirements.
2. Prefer analysis tools (askell_customer_overview, askell_contract_overview, askell_billing_run_triage, askell_paginate_all, askell_list_webhooks) for common support tasks.
3. Use askell_call (GET/HEAD) or askell_mutate (POST/PUT/PATCH/DELETE) when no dedicated tool covers the request.

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

V2 discounts (coupons / promotion codes) — not the same as v1:
- v2 contracts: one active coupon at a time. GET /v2/subscription-contracts/{id}/discount/ (also nested as contract.discount). Apply with POST .../apply-code/ {promotion_code}. Remove with POST .../remove-discount/.
- Quotes: pass promotion_code on POST /v2/subscription-offer-quotes/; totals already include the discount when set.
- v1 Subscription.discount is a 0-100 percent override on a PlanVariant subscription. Do not send it to v2 contract endpoints.

V2 checkout notes:
- checkout_url on V2 checkouts points to the API object URL, not a browser payment page.
- Embedded checkout uses POST /v2/checkout-sessions/ plus browser session-token sub-paths (see docs, not all in OpenAPI).

Auth:
- Most endpoints need the secret API key.
- Only temporary payment method and checkout status endpoints use the public key.

Safety:
- Writes go through askell_mutate (destructiveHint). Reads go through askell_call (readOnlyHint).
- mutationGate=auto (default): confirmation form only if this request's envelope declared form elicitation; otherwise the client's own tool-allow UI is the gate. elicit always returns a form (SDK refuses if the client cannot fulfil it). off never asks.
- Large list responses are compacted (index of id/dates/plan/customer) to fit responseMaxBytes before dropping rows; check meta.truncatedByMaxBytes, meta.compacted, and meta.compactedMode.
- Tool output redacts webhook hmac_secret to \`<redacted len=N>\` (Askell list/get/create return the plaintext secret).

Resources:
- askell://spec/v1 and askell://spec/v2 — bundled OpenAPI
- askell://docs/webhook-events — inbound webhook payloads (not in OpenAPI; dummy /your-webhook-url/ is stripped on sync), HMAC-SHA512, /webhooks/ hmac_secret`;
}

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: 'askell-mcp',
      version: PACKAGE_VERSION,
    },
    {
      instructions: buildServerInstructions(config),
    },
  );

  const client = new AskellClient(config);

  registerDiscoveryTools(server);
  registerCallTools(server, client, config);
  registerAnalysisTools(server, client);
  registerResources(server);

  return server;
}
