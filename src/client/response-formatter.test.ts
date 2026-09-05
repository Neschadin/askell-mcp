import { describe, expect, test } from 'bun:test';

import {
  buildBoundedListPayload,
  formatApiResponse,
  isMutatingMethod,
  limitText,
  truncateUtf8,
} from './response-formatter.ts';

describe('truncateUtf8', () => {
  test('returns original when under limit', () => {
    expect(truncateUtf8('hello', 100)).toBe('hello');
  });

  test('cuts to max bytes without breaking UTF-8', () => {
    const text = 'áááá'; // 2 bytes each in UTF-8
    const out = truncateUtf8(text, 3);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(3);
    expect(out).toBe('á');
  });
});

describe('limitText', () => {
  test('marks truncation', () => {
    const result = limitText('abcdefghij', 5);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(5);
  });
});

describe('buildBoundedListPayload', () => {
  test('returns full payload when under maxBytes', () => {
    const result = buildBoundedListPayload({
      status: 200,
      meta: { path: '/customers/' },
      items: [{ id: 1 }, { id: 2 }],
      maxBytes: 64_000,
    });

    expect(result.truncated).toBe(false);
    const parsed = JSON.parse(result.text) as {
      meta: { returnedCount: number; truncatedByMaxBytes: boolean };
      body: unknown[];
    };
    expect(parsed.body).toHaveLength(2);
    expect(parsed.meta.truncatedByMaxBytes).toBe(false);
  });

  test('truncates large lists to valid JSON under maxBytes', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `customer-${i}`,
      email: `user${i}@example.com`,
      description: 'x'.repeat(80),
    }));

    const result = buildBoundedListPayload({
      status: 200,
      meta: { path: '/customers/', pageCount: 5 },
      items,
      maxBytes: 2_000,
    });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(2_000);

    const parsed = JSON.parse(result.text) as {
      meta: {
        itemCount: number;
        returnedCount: number;
        truncatedByMaxBytes: boolean;
      };
      body: unknown[];
    };
    expect(parsed.meta.itemCount).toBe(200);
    expect(parsed.meta.returnedCount).toBe(parsed.body.length);
    expect(parsed.meta.truncatedByMaxBytes).toBe(true);
    expect(parsed.body.length).toBeGreaterThan(0);
    expect(parsed.body.length).toBeLessThan(200);
  });

  test('compacts all rows instead of dropping them when pretty JSON overflows', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: 60_000 + i,
      start_date: '2026-07-07T12:00:00.825876Z',
      plan: {
        id: 1,
        name: 'Grunnáskrift',
        description: 'x'.repeat(400),
      },
      customer: {
        id: i,
        customer_reference: `cust_${i}`,
        email: `user${i}@example.com`,
      },
      description: 'y'.repeat(800),
      billing_logs: Array.from({ length: 5 }, () => ({
        note: 'z'.repeat(120),
      })),
    }));

    const result = buildBoundedListPayload({
      status: 200,
      meta: { path: '/subscriptions/' },
      items,
      maxBytes: 12_000,
    });

    const parsed = JSON.parse(result.text) as {
      meta: {
        itemCount: number;
        returnedCount: number;
        truncatedByMaxBytes: boolean;
        compacted?: boolean;
        compactedMode?: string;
      };
      body: Array<{ id?: number; plan?: unknown; customer_reference?: unknown }>;
    };

    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(12_000);
    expect(parsed.meta.itemCount).toBe(80);
    expect(parsed.meta.returnedCount).toBe(80);
    expect(parsed.meta.truncatedByMaxBytes).toBe(false);
    expect(parsed.meta.compacted).toBe(true);
    expect(parsed.body).toHaveLength(80);
  });

  test('502 subscription-like rows fit in the default 64k budget', () => {
    const items = Array.from({ length: 502 }, (_, i) => ({
      id: 60_000 + i,
      start_date: '2026-07-07T12:00:00.825876Z',
      plan: { id: 1, name: i % 3 === 0 ? 'Grunnáskrift' : 'Plús' },
      customer: { id: i, customer_reference: `customer-reference-${i}` },
      description: 'payload'.repeat(80),
      billing_logs: [{ id: i, amount: 1000, currency: 'ISK' }],
    }));

    const result = buildBoundedListPayload({
      status: 200,
      meta: { pagesFetched: 6 },
      items,
      maxBytes: 64_000,
    });

    const parsed = JSON.parse(result.text) as {
      meta: {
        itemCount: number;
        returnedCount: number;
        truncatedByMaxBytes: boolean;
        compacted?: boolean;
      };
      body: unknown[];
    };

    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(64_000);
    expect(parsed.meta.itemCount).toBe(502);
    expect(parsed.meta.returnedCount).toBe(502);
    expect(parsed.meta.truncatedByMaxBytes).toBe(false);
    expect(parsed.body).toHaveLength(502);
  });
});

describe('formatApiResponse', () => {
  test('redacts hmac_secret in JSON bodies', () => {
    const secret = 'live-hmac-secret-value';
    const result = formatApiResponse(
      200,
      new Headers({ 'content-type': 'application/json' }),
      JSON.stringify([
        {
          id: 1,
          event: 'payment.*',
          hmac_digest: 'SHA512',
          hmac_secret: secret,
        },
      ]),
      64_000,
    );

    expect(result.text).not.toContain(secret);
    const parsed = JSON.parse(result.text) as {
      body: Array<{ hmac_secret: string; hmac_digest: string }>;
    };
    expect(parsed.body[0]?.hmac_digest).toBe('SHA512');
    expect(parsed.body[0]?.hmac_secret).toBe(
      `<redacted len=${secret.length}>`,
    );
  });
});

describe('buildBoundedListPayload secrets', () => {
  test('redacts hmac_secret before compacting', () => {
    const secret = 'paginate-hmac-secret';
    const result = buildBoundedListPayload({
      status: 200,
      meta: { path: '/webhooks/' },
      items: [
        { id: 1, event: 'checkout.*', hmac_secret: secret, uuid: 'u1' },
      ],
      maxBytes: 64_000,
    });

    expect(result.text).not.toContain(secret);
    const parsed = JSON.parse(result.text) as {
      body: Array<{ hmac_secret: string }>;
    };
    expect(parsed.body[0]?.hmac_secret).toBe(
      `<redacted len=${secret.length}>`,
    );
  });
});

describe('isMutatingMethod', () => {
  test('GET/HEAD/OPTIONS are read-only', () => {
    expect(isMutatingMethod('GET')).toBe(false);
    expect(isMutatingMethod('head')).toBe(false);
    expect(isMutatingMethod('OPTIONS')).toBe(false);
  });

  test('POST/PUT/PATCH/DELETE mutate', () => {
    expect(isMutatingMethod('POST')).toBe(true);
    expect(isMutatingMethod('put')).toBe(true);
    expect(isMutatingMethod('PATCH')).toBe(true);
    expect(isMutatingMethod('DELETE')).toBe(true);
  });
});
