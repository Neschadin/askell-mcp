import { describe, expect, test } from 'bun:test';

import { WEBHOOK_EVENTS_DOC } from './register.ts';

describe('webhook-events resource', () => {
  test('names fulfillment fulfill/cancel events and mutate paths', () => {
    expect(WEBHOOK_EVENTS_DOC).toContain('fulfillment_order.fulfilled');
    expect(WEBHOOK_EVENTS_DOC).toContain('fulfillment_order.cancelled');
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'POST /v2/fulfillment-orders/{id}/fulfill/',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain('POST .../cancel/');
    expect(WEBHOOK_EVENTS_DOC).toContain('order_cancelled');
    expect(WEBHOOK_EVENTS_DOC).toContain('booking_in_progress');
    expect(WEBHOOK_EVENTS_DOC).toContain('fulfillment_order.created');
    expect(WEBHOOK_EVENTS_DOC).toContain('fulfillment_order.shipment_booked');
    expect(WEBHOOK_EVENTS_DOC).toContain('shipment_id');
    expect(WEBHOOK_EVENTS_DOC).toContain('Do not invent `changed`');
    expect(WEBHOOK_EVENTS_DOC).not.toContain('Do not invent `created`/`changed`');
    expect(WEBHOOK_EVENTS_DOC).not.toContain('Read-only — no mark-shipped mutate');
    expect(WEBHOOK_EVENTS_DOC).not.toContain(
      'Concrete event names beyond the family are not listed',
    );
  });

  test('routes V2 billing-run refunds off the payment uuid', () => {
    expect(WEBHOOK_EVENTS_DOC).toContain('billing_run_id');
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'POST /v2/billing-runs/{billingRunId}/refund/',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'Do not `POST /payments/{uuid}/refund/`',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain('billing_run.changed');
    expect(WEBHOOK_EVENTS_DOC).toContain('refunded');
    expect(WEBHOOK_EVENTS_DOC).toContain('`reference` and `scheduled_changes`');
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'subscription_contract_scheduled_change.created',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'subscription_contract_scheduled_change.applied',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'subscription_contract_scheduled_change.canceled',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'Not covered by `subscription_contract.*`',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain('Hook-API-Version: v2');
    expect(WEBHOOK_EVENTS_DOC).toContain('subscription_contract_id');
    expect(WEBHOOK_EVENTS_DOC).toContain('billing_run_attempt_id');
    expect(WEBHOOK_EVENTS_DOC).toContain('retry_scheduled');
    expect(WEBHOOK_EVENTS_DOC).toContain('customer_id');
    expect(WEBHOOK_EVENTS_DOC).toContain('`customer` is an object');
    expect(WEBHOOK_EVENTS_DOC).toContain('subscription_contract.ended');
    expect(WEBHOOK_EVENTS_DOC).toContain('migration_batch_id');
    expect(WEBHOOK_EVENTS_DOC).toContain(
      'subscription_contract_item.entitlement_changed',
    );
    expect(WEBHOOK_EVENTS_DOC).toContain('contract_id');
    expect(WEBHOOK_EVENTS_DOC).toContain('failed_terminal');
    expect(WEBHOOK_EVENTS_DOC).not.toContain('`contract`, `period_start_at`');
    expect(WEBHOOK_EVENTS_DOC).not.toContain(
      'do not assume the payload gained them',
    );
  });
});
