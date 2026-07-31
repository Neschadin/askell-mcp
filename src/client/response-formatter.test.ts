import { describe, expect, test } from 'bun:test';

import {
  buildBoundedListPayload,
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
