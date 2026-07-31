import { describe, expect, test } from 'bun:test';

import { ConfigSchema, normalizeBaseUrl } from './config.ts';

describe('ConfigSchema', () => {
  test('applies defaults', () => {
    const parsed = ConfigSchema.parse({ secretApiKey: 'secret.key' });
    expect(parsed.apiBaseUrl).toBe('https://askell.is/api');
    expect(parsed.responseMaxBytes).toBe(64_000);
    expect(parsed.requireMutationApproval).toBe(true);
    expect(parsed.publicApiKey).toBeUndefined();
  });

  test('rejects empty secret', () => {
    const result = ConfigSchema.safeParse({ secretApiKey: '' });
    expect(result.success).toBe(false);
  });

  test('rejects non-http apiBaseUrl', () => {
    const result = ConfigSchema.safeParse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  test('accepts optional public key and overrides', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      publicApiKey: 'public.key',
      apiBaseUrl: 'https://staging.askell.is/api',
      responseMaxBytes: 10_000,
      requireMutationApproval: false,
    });
    expect(parsed.publicApiKey).toBe('public.key');
    expect(parsed.responseMaxBytes).toBe(10_000);
    expect(parsed.requireMutationApproval).toBe(false);
  });
});

describe('normalizeBaseUrl', () => {
  test('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://askell.is/api///')).toBe(
      'https://askell.is/api',
    );
  });
});
