import { describe, expect, test } from 'bun:test';

import {
  PRODUCTION_API_BASE_URL,
  type AppConfig,
} from '../config.ts';
import { AskellClient } from './askell-client.ts';

const config: AppConfig = {
  askellEnv: 'production',
  apiBaseUrl: PRODUCTION_API_BASE_URL,
  secretApiKey: 'secret.key',
  publicApiKey: 'public.key',
  responseMaxBytes: 131_072,
  mutationGate: 'auto',
};

function stubFetch(
  responder?: (url: URL, init?: RequestInit) => Response,
): {
  calls: Array<{ url: URL; headers: Headers }>;
  restore: () => void;
} {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : typeof input === 'string'
          ? new URL(input)
          : new URL(input.url);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (responder) {
      return responder(url, init);
    }
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = previous;
    },
  };
}

describe('AskellClient authorization', () => {
  test('none sends no Authorization header', async () => {
    const fetchMock = stubFetch();
    try {
      const client = new AskellClient(config);
      const response = await client.request({
        method: 'GET',
        path: '/subscriptions/1/discount/',
        query: { subscription_token: 'sub-token' },
        apiKeyKind: 'none',
      });

      expect(response.ok).toBe(true);
      expect(fetchMock.calls[0]?.headers.get('authorization')).toBeNull();
    } finally {
      fetchMock.restore();
    }
  });

  test('secret and public send the matching key', async () => {
    const fetchMock = stubFetch();
    try {
      const client = new AskellClient(config);
      await client.request({
        method: 'GET',
        path: '/customers/',
        apiKeyKind: 'secret',
      });
      await client.request({
        method: 'POST',
        path: '/temporarypaymentmethod/',
        apiKeyKind: 'public',
        body: { pan: '4242' },
      });

      expect(fetchMock.calls[0]?.headers.get('authorization')).toBe(
        'Api-Key secret.key',
      );
      expect(fetchMock.calls[1]?.headers.get('authorization')).toBe(
        'Api-Key public.key',
      );
    } finally {
      fetchMock.restore();
    }
  });
});

describe('AskellClient.paginateAll security & query params', () => {
  test('resolves relative next links and serializes array query params', async () => {
    let callIndex = 0;
    const fetchMock = stubFetch(() => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            results: [{ id: 1 }],
            next: '/api/v2/claim-rules/?page=2&page_size=1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ results: [{ id: 2 }], next: null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    try {
      const client = new AskellClient(config);
      const res = await client.paginateAll({
        path: '/v2/claim-rules/',
        query: { page_size: 1, tag: ['a', 'b'] },
      });

      expect(res.ok).toBe(true);
      expect(fetchMock.calls).toHaveLength(2);
      expect(fetchMock.calls[0]?.url.searchParams.getAll('tag')).toEqual([
        'a',
        'b',
      ]);
      expect(fetchMock.calls[1]?.url.toString()).toBe(
        'https://askell.is/api/v2/claim-rules/?page=2&page_size=1',
      );
    } finally {
      fetchMock.restore();
    }
  });

  test('refuses cross-origin or http-downgraded pagination links before sending secret key', async () => {
    const fetchMock = stubFetch(() =>
      new Response(
        JSON.stringify({
          results: [{ id: 1 }],
          next: 'http://askell.is/api/v2/claim-rules/?page=2',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    try {
      const client = new AskellClient(config);
      await expect(
        client.paginateAll({ path: '/v2/claim-rules/' }),
      ).rejects.toThrow(/Refusing cross-origin or protocol-downgraded/i);
      expect(fetchMock.calls).toHaveLength(1);
    } finally {
      fetchMock.restore();
    }
  });
});
