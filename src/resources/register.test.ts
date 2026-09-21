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
    expect(WEBHOOK_EVENTS_DOC).toContain('Do not invent `created`/`changed`');
    expect(WEBHOOK_EVENTS_DOC).not.toContain('Read-only — no mark-shipped mutate');
    expect(WEBHOOK_EVENTS_DOC).not.toContain(
      'Concrete event names beyond the family are not listed',
    );
  });
});
