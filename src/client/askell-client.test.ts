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
  responseMaxBytes: 64_000,
  mutationGate: 'auto',
};

function stubFetch(): {
  calls: Array<{ headers: Headers }>;
  restore: () => void;
} {
  const calls: Array<{ headers: Headers }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers) });
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
