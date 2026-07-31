import type { McpServer } from '@modelcontextprotocol/server';

import { getBundledSpec } from '../openapi/registry.ts';

const WEBHOOK_EVENTS_DOC = `# Askell webhook events (reference)

Askell sends signed webhook calls to your configured endpoints.

Headers:
- Hook-HMAC: base64 HMAC-SHA512 of the raw body
- Hook-Event: event type identifier
- Hook-API-Version: v1 for legacy plan/subscription webhooks, v2 for subscription contract webhooks

Event families:
- subscription.* (legacy v1): subscription.created, subscription.changed, subscription.renewed
- subscription_contract.* (v2): subscription_contract.created, subscription_contract.changed,
  subscription_contract.renewed, subscription_contract.migrated (legacy subscription migrated to a
  V2 contract; payload includes legacy_subscription_ids and migration_effective_at)
- billing_run.* (v2): billing_run.created, billing_run.changed, billing_run.succeeded,
  billing_run.failed, billing_run.retry
- customer.*: customer.created, customer.changed
- payment.*: payment.created, payment.changed, payment.retry
- checkout.*: checkout.created, checkout.changed

Notes:
- During migration to V2, legacy subscription.* aliases are NOT sent for the new contract (event data
  is based on SubscriptionContract, not Subscription), and subscription.canceled is not sent solely
  because billing moved to a V2 contract.

Webhook management is available via v1 API:
- GET/POST /webhooks/
- GET/PATCH/DELETE /webhooks/{id}/

This MCP server exposes webhook management through askell_call and askell_list_webhooks.
`;

export function registerResources(server: McpServer): void {
  server.registerResource(
    'openapi-v1',
    'askell://spec/v1',
    {
      title: 'Askell OpenAPI v1',
      description: 'Bundled OpenAPI 3 spec for Askell API v1',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'askell://spec/v1',
          mimeType: 'application/json',
          text: JSON.stringify(getBundledSpec('v1'), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'openapi-v2',
    'askell://spec/v2',
    {
      title: 'Askell OpenAPI v2',
      description:
        'Bundled OpenAPI 3 spec for Askell Subscription Contracts V2',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'askell://spec/v2',
          mimeType: 'application/json',
          text: JSON.stringify(getBundledSpec('v2'), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'webhook-events',
    'askell://docs/webhook-events',
    {
      title: 'Askell webhook events',
      description: 'Webhook event types and management overview',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'askell://docs/webhook-events',
          mimeType: 'text/markdown',
          text: WEBHOOK_EVENTS_DOC,
        },
      ],
    }),
  );
}
