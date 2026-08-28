import { describe, expect, test } from 'bun:test';

import { ConfigSchema, MutationGateSchema, normalizeBaseUrl } from './config.ts';

describe('ConfigSchema', () => {
  test('applies defaults', () => {
    const parsed = ConfigSchema.parse({ secretApiKey: 'secret.key' });
    expect(parsed.apiBaseUrl).toBe('https://askell.is/api');
    expect(parsed.responseMaxBytes).toBe(64_000);
    expect(parsed.mutationGate).toBe('auto');
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

  test('rejects non-http(s) schemes', () => {
    const result = ConfigSchema.safeParse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'ftp://askell.is/api',
    });
    expect(result.success).toBe(false);
  });

  test('accepts localhost and loopback HTTP URLs', () => {
    const local = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'http://localhost:8000/api',
    });
    expect(local.apiBaseUrl).toBe('http://localhost:8000/api');

    const loopback = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'http://127.0.0.1:8000',
    });
    expect(loopback.apiBaseUrl).toBe('http://127.0.0.1:8000');
  });

  test('coerces env-style strings for bytes and mutation gate', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      responseMaxBytes: '10000',
      mutationGate: 'off',
    });
    expect(parsed.responseMaxBytes).toBe(10_000);
    expect(parsed.mutationGate).toBe('off');
  });

  test('rejects empty public key', () => {
    const result = ConfigSchema.safeParse({
      secretApiKey: 'secret.key',
      publicApiKey: '',
    });
    expect(result.success).toBe(false);
  });

  test('accepts optional public key and overrides', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      publicApiKey: 'public.key',
      apiBaseUrl: 'https://staging.askell.is/api',
      responseMaxBytes: 10_000,
      mutationGate: false,
    });
    expect(parsed.publicApiKey).toBe('public.key');
    expect(parsed.responseMaxBytes).toBe(10_000);
    expect(parsed.mutationGate).toBe('off');
  });
});

describe('MutationGateSchema', () => {
  test('defaults to auto', () => {
    expect(MutationGateSchema.parse(undefined)).toBe('auto');
  });

  test('accepts auto/elicit/off', () => {
    expect(MutationGateSchema.parse('auto')).toBe('auto');
    expect(MutationGateSchema.parse('elicit')).toBe('elicit');
    expect(MutationGateSchema.parse('off')).toBe('off');
  });

  test('maps booleans and ASKELL_REQUIRE_MUTATION_APPROVAL aliases', () => {
    expect(MutationGateSchema.parse(true)).toBe('elicit');
    expect(MutationGateSchema.parse(false)).toBe('off');
    expect(MutationGateSchema.parse('true')).toBe('elicit');
    expect(MutationGateSchema.parse('false')).toBe('off');
    expect(MutationGateSchema.parse('on')).toBe('elicit');
    expect(MutationGateSchema.parse('yes')).toBe('elicit');
    expect(MutationGateSchema.parse('1')).toBe('elicit');
    expect(MutationGateSchema.parse('no')).toBe('off');
    expect(MutationGateSchema.parse('0')).toBe('off');
  });

  test('rejects unknown values', () => {
    expect(MutationGateSchema.safeParse('maybe').success).toBe(false);
  });
});

describe('normalizeBaseUrl', () => {
  test('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://askell.is/api///')).toBe(
      'https://askell.is/api',
    );
  });
});
