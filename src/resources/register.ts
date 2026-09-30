import type { McpServer } from '@modelcontextprotocol/server';

import { getBundledSpec } from '../openapi/registry.ts';

export const WEBHOOK_EVENTS_DOC = `# Askell webhook events (reference)

Askell POSTs signed JSON to each URL you register. Verify \`Hook-HMAC\` before parsing.

Headers:
- Hook-HMAC: base64 HMAC-SHA512 of the **raw body** (secret = \`hmac_secret\` from webhook create)
- Hook-Event: event type (\`subscription.renewed\`, \`payment.changed\`, or a family wildcard \`subscription.*\`)
- Hook-API-Version: \`v1\` for plan/subscription/customer/checkout and one-off \`payment.*\`; \`v2\` for subscription_contract / billing_run / fulfillment_order and for \`payment.*\` of a billing-run charge

## Body shape

JSON body **is the event object**. It is **not** \`{ event, data }\`.

Upstream swagger used to document a dummy \`POST /your-webhook-url/\` with \`SubscriptionMultiLite\` (\`{ customer, subscriptions[] }\`). \`sync-specs\` strips that path.

Most inbound families are still undocumented in OpenAPI — this resource is the overlay. Exception: \`fulfillment_order.*\` body **is** \`V2FulfillmentOrder\` (same as \`GET /v2/fulfillment-orders/{id}/\`). Live https://docs.askell.is/en/api/webhooks.html lists that family (\`created\`, \`shipment_booked\`, \`fulfilled\`, \`cancelled\`).

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
\`created\`, \`changed\`, \`renewed\`, \`migrated\`. Live https://docs.askell.is/en/api/webhooks.html also names \`activated\`, \`paused\`, \`resumed\`, \`canceled\`, \`ended\`.

A scheduled cancellation sends \`subscription_contract.ended\`, not \`canceled\`, even though \`state\` becomes \`canceled\`. \`canceled\` is only an immediate cancel. \`changed\` often arrives next to the more specific event.

Except \`migrated\`, the body is the contract as GET \`/v2/subscription-contracts/{id}/\` returns it (\`V2SubscriptionContract\`). \`customer\` is an object; the numeric id is \`customer_id\`. The page also puts \`reference\` and \`scheduled_changes\` on that body, and a pending item change on item \`scheduled_change\` (the example JSON omits \`scheduled_changes\`; the following paragraph names it). The example includes \`legacy_source_mappings\`, which OpenAPI does not list.

\`migrated\` is not the whole contract, and \`customer\` there is a numeric id. Fields: \`id\` / \`subscription_contract_id\` (same value), \`migration_batch_id\`, \`customer\`, \`customer_reference\`, \`billing_managed_by\`, \`migration_effective_at\`, \`legacy_subscription_ids\`, \`legacy_source_mappings\`.

\`subscription_contract_scheduled_change.*\` and \`subscription_contract_item.*\` are not included in this family.

### subscription_contract_item.* (v2)
Not covered by \`subscription_contract.*\`. Register \`subscription_contract_item.*\` or \`subscription_contract_item.entitlement_changed\`.

Sent when an item's entitlement changes (\`service_active\` / \`service_state\`, \`entitled_until\`, quantity, or product). \`id\` and \`contract_item_id\` are the item id. Also \`subscription_contract_id\`, numeric \`customer\`, \`customer_reference\`, \`changed_fields\`, and \`previous\` (entitlement fields before the change).

### subscription_contract_scheduled_change.* (v2)
Not covered by \`subscription_contract.*\`. Register \`subscription_contract_scheduled_change.*\` or a specific event.

\`subscription_contract_scheduled_change.created\` — item change scheduled for the next renewal (\`apply_at=period_end\`). \`subscription_contract_scheduled_change.applied\` — applied when that renewal's billing run is created. \`subscription_contract_scheduled_change.canceled\` — canceled via the API, or automatically when the item is removed or the contract is canceled.

Payload is the scheduled change (same shape as \`scheduled_changes[]\`) plus \`subscription_contract_id\`, \`customer\` (numeric id), \`customer_reference\`. \`operation\` is \`update_item\`. \`state\` is \`scheduled\` / \`applied\` / \`canceled\`. \`applied_at\`, \`applied_change_id\`, and \`billing_run_id\` are set only on \`applied\`. \`canceled_at\` is set only on \`canceled\`.

### billing_run.* (v2)
\`created\`, \`changed\`, \`succeeded\`, \`failed\`, \`retry\`

Body matches \`V2BillingRun\`: \`contract_id\` (not \`contract\`), \`customer_id\`, \`period_start_at\`, \`period_end_at\`, \`state\`, amounts, \`attempt_count\`, \`max_attempts\`, \`next_retry_at\`, \`last_attempt_at\`, \`transaction_id\`, \`transaction_uuid\`, \`transaction_external_reference\` (null when no transaction exists), \`lines\`, \`attempts\`. Live page \`state\` values: \`scheduled\`, \`processing\`, \`retry_scheduled\`, \`pending_external\`, \`succeeded\`, \`failed_terminal\`, \`canceled\`, \`voided\`, \`refunded\`. OpenAPI leaves \`state\` an unconstrained string.

Refunding a succeeded run (\`POST /v2/billing-runs/{id}/refund/\`) sends \`billing_run.changed\`, not a new event type. The run's \`state\` becomes \`refunded\`. A \`202\` means the run is still \`succeeded\`.

### customer.* (v1)
\`created\`, \`changed\` — same shape as GET \`/customers/{ref}/\` (\`id\`, names, \`email\`, \`phone\`, \`customer_reference\`, address fields, \`payment_method[]\`).

### payment.*
\`created\`, \`changed\`, \`retry\`. One registration receives both shapes. Tell them apart with \`Hook-API-Version\`, or with \`subscription_contract_id\` (only on a billing-run charge).

One-off Payment (\`Hook-API-Version: v1\`): \`uuid\`, \`amount\`, \`currency\`, \`description\`, \`reference\`, \`state\` (\`pending\` | \`settled\` | \`failed\` | \`retrying\`), \`created_at\`, \`updated_at\`, \`transactions[]\`.

Billing-run charge (\`Hook-API-Version: v2\`): a flat transaction, no \`transactions[]\`. \`uuid\` (transaction id), \`amount\`, \`currency\`, \`description\`, \`reference\` (processor reference), \`state\` (\`initial\` | \`pending\` | \`settled\` | \`failed\` | \`canceled\` | \`refunded\`), \`fail_code\`, \`refund_code\`, \`cancel_code\`, \`payment_method\` (numeric id), \`billing_run_id\`, \`billing_run_attempt_id\`, \`subscription_contract_id\`, \`customer\`, \`customer_reference\`, \`legacy_subscription_ids\`. \`payment.created\` when an attempt opens a transaction, \`payment.changed\` when the charge succeeds, fails permanently, or waits on the processor, \`payment.retry\` when another attempt is scheduled. A \`payment.retry\` with no transaction has null \`uuid\`, \`reference\`, \`created_at\`, \`updated_at\`, \`payment_method\`, and codes; \`amount\` / \`currency\` come from the run, and \`state\` is the run's state (for example \`retry_scheduled\`).

That \`uuid\` is not a Payment. Do not \`POST /payments/{uuid}/refund/\`. Refund with \`POST /v2/billing-runs/{billingRunId}/refund/\`.

### checkout.* (v1)
\`created\`, \`changed\` — \`token\`, \`checkout_url\`, \`status\`.

### fulfillment_order.* (v2)
Live https://docs.askell.is/en/api/webhooks.html names \`fulfillment_order.created\` (after payment succeeds), \`fulfillment_order.shipment_booked\` (tracking is available; the payload also has \`shipment_id\` pointing at that entry in \`fulfillments[]\`), \`fulfillment_order.fulfilled\`, and \`fulfillment_order.cancelled\`. Swagger operation text only names \`fulfilled\` and \`cancelled\`. Do not invent \`changed\`.

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
