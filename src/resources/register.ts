import type { McpServer } from '@modelcontextprotocol/server';

import { getBundledSpec } from '../openapi/registry.ts';

export const WEBHOOK_EVENTS_DOC = `# Askell webhook events (reference)

Askell POSTs signed JSON to each URL you register. Verify \`Hook-HMAC\` before parsing.

Headers:
- Hook-HMAC: base64 HMAC-SHA512 of the **raw body** (secret = \`hmac_secret\` from webhook create)
- Hook-Event: event type (\`subscription.renewed\`, \`payment.changed\`, or a family wildcard \`subscription.*\`)
- Hook-API-Version: \`v1\` for plan/subscription/customer/payment/checkout, \`v2\` for subscription_contract / billing_run / fulfillment_order

## Body shape

JSON body **is the event object**. It is **not** \`{ event, data }\`.

Upstream swagger used to document a dummy \`POST /your-webhook-url/\` with \`SubscriptionMultiLite\` (\`{ customer, subscriptions[] }\`). \`sync-specs\` strips that path.

Most inbound families are still undocumented in OpenAPI — this resource is the overlay. Exception: \`fulfillment_order.*\` body **is** \`V2FulfillmentOrder\` (same as \`GET /v2/fulfillment-orders/{id}/\`). Live https://docs.askell.is/en/api/webhooks.html does not list this family yet.

Rare historical payloads used \`{ event, data, ref?, sender? }\`. If both \`event\` and \`data\` are objects, use \`data\`.

## Registering endpoints (v1 management API)

- GET/POST \`/webhooks/\` · GET/PUT/PATCH/DELETE \`/webhooks/{id}/\` (secret key). Live GET \`/webhooks/{id}/\` exists even if OpenAPI omits it.
- Create body: \`{ url, event }\` (\`event\` may be a specific type or a family wildcard like \`payment.*\`)
- Askell returns plaintext \`hmac_secret\` on list, get, and create (it is re-readable, not create-only), plus \`hmac_digest\` (typically \`SHA512\`)
- MCP tool output redacts \`hmac_secret\` to \`<redacted len=N>\`. Do not treat that placeholder as the real secret. Copy the secret from the Askell dashboard or a direct API call outside MCP.

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

### fulfillment_order.* (v2)
Family wildcard \`fulfillment_order.*\`. Bundled swagger names \`fulfillment_order.fulfilled\` (\`POST .../fulfill/\` or dashboard ship) and \`fulfillment_order.cancelled\` (\`POST .../cancel/\`). Do not invent \`created\`/\`changed\`. Live https://docs.askell.is/en/api/webhooks.html still omits this family.

Body = \`V2FulfillmentOrder\` = \`GET /v2/fulfillment-orders/{fulfillmentOrderId}/\` (list items are the same object). Physical order from a paid billing run (\`billing_run_id\`; at most one order per run). \`delivery_address\` is a snapshot (later contract address edits do not change it). \`shipping_selection\` is the checkout snapshot. \`fulfillments[]\` are booked shipments (empty until booked / if no shipping providers). Status: \`open\` | \`partially_fulfilled\` | \`fulfilled\` | \`cancelled\`. External carrier with no Askell integration: shipment \`handler\` is \`""\` — read \`carrier\`.

Register \`fulfillment_order.*\` on \`POST /webhooks/\`. REST backfill: \`GET /v2/fulfillment-orders/?updated_since=\` (secret; newest first; \`403\` if the account has no subscription contracts or shipping is disabled). Mutate via \`askell_mutate\`: \`POST /v2/fulfillment-orders/{id}/fulfill/\` (optional body) and \`POST .../cancel/\` (no body). Both idempotent \`200\` if already in that state (webhook/email not replayed). \`409\` codes: \`order_cancelled\`, \`order_fulfilled\`, \`booking_in_progress\`.
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
