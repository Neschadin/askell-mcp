import type { McpServer } from '@modelcontextprotocol/server';

import { getBundledSpec } from '../openapi/registry.ts';

const WEBHOOK_EVENTS_DOC = `# Askell webhook events (reference)

Askell POSTs signed JSON to each URL you register. Verify \`Hook-HMAC\` before parsing.

Headers:
- Hook-HMAC: base64 HMAC-SHA512 of the **raw body** (secret = \`hmac_secret\` from webhook create)
- Hook-Event: event type (\`subscription.renewed\`, \`payment.changed\`, or a family wildcard \`subscription.*\`)
- Hook-API-Version: \`v1\` for plan/subscription/customer/payment/checkout, \`v2\` for subscription_contract / billing_run

## Body shape (not in OpenAPI)

JSON body **is the event object**. It is **not** \`{ event, data }\`.

Upstream swagger used to document a dummy \`POST /your-webhook-url/\` with \`SubscriptionMultiLite\` (\`{ customer, subscriptions[] }\`). \`sync-specs\` strips that path. Inbound payloads are still undocumented in OpenAPI — this resource is the overlay.

Rare historical payloads used \`{ event, data, ref?, sender? }\`. If both \`event\` and \`data\` are objects, use \`data\`.

## Registering endpoints (v1 management API)

- GET/POST \`/webhooks/\` · GET/PUT/PATCH/DELETE \`/webhooks/{id}/\` (secret key)
- Create body: \`{ url, event }\` (\`event\` may be a specific type or a family wildcard like \`payment.*\`)
- Create/get response includes \`hmac_secret\` (store it; Askell will not show it again in a useful way if you lose it) and \`hmac_digest\` (typically \`SHA512\`)

Tools: \`askell_list_webhooks\`, \`askell_call\` (GET), \`askell_mutate\` (POST/PUT/PATCH/DELETE).

## Event families and payload fields

Live REST \`Subscription\` objects have extra fields the OpenAPI schema omits. Webhook bodies differ slightly from GET \`/subscriptions/\` (notably \`last_billing_log\` vs \`billing_logs[]\`).

### subscription.* (v1)
\`subscription.created\`, \`subscription.changed\`, \`subscription.renewed\`

\`id\`, \`plan\` (no \`payment_processor\` / membership-card / wallet-pass fields), \`customer\` (numeric id), \`customer_reference\`, \`trial_end\`, \`start_date\`, \`ended_at\`, \`reference\`, \`active\`, \`meta\` (JSON **string**, often \`"{}"\`), \`description\`, \`active_until\`, \`is_on_trial\`, \`token\`, \`is_failing\`, \`last_billing_log\` (single object or null — not \`billing_logs[]\`), \`delivery_address\`, \`amount\`. Live cancel/change events also send \`cancelled\`, \`cancel_date\`, \`has_payment_plan\`, \`payment_plan_info\`.

V2 migration: \`subscription.*\` is **not** aliased onto the new contract (payload is \`SubscriptionContract\`). \`subscription.canceled\` is not sent merely because billing moved to a V2 contract.

### subscription_contract.* (v2)
\`created\`, \`changed\`, \`renewed\`, \`migrated\`

\`id\`, \`customer\`, \`state\`, \`billing_anchor_at\`, \`next_billing_at\`, \`cancel_at\`, \`cancel_at_period_end\`, \`canceled_at\`, \`ended_at\`, \`currency\`, \`recurring\`, \`legacy_subscription\`, \`legacy_subscription_ids\`, \`migration_effective_at\`, \`billing_managed_by\`, \`created_at\`, \`updated_at\`.

### billing_run.* (v2)
\`created\`, \`changed\`, \`succeeded\`, \`failed\`, \`retry\`

\`id\`, \`contract\`, \`period_start_at\`, \`period_end_at\`, \`state\`, \`currency\`, \`subtotal_amount\`, \`tax_amount\`, \`total_amount\`, \`attempt_count\`, \`max_attempts\`, \`next_retry_at\`, \`last_attempt_at\`, \`transaction\`, \`created_at\`, \`updated_at\`.

### customer.* (v1)
\`created\`, \`changed\` — same shape as GET \`/customers/{ref}/\` (\`id\`, names, \`email\`, \`phone\`, \`customer_reference\`, address fields, \`payment_method[]\`).

### payment.* (v1)
\`created\`, \`changed\`, \`retry\`

\`uuid\`, \`amount\`, \`currency\`, \`description\`, \`reference\`, \`state\` (\`pending\` | \`settled\` | \`failed\` | \`retrying\`), \`created_at\`, \`updated_at\`, \`transactions[]\`.

### checkout.* (v1)
\`created\`, \`changed\` — \`token\`, \`checkout_url\`, \`status\`.
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
      description: 'Inbound webhook events, payload shapes, HMAC, and /webhooks/ management',
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
