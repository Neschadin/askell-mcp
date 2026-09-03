import { describe, expect, test } from 'bun:test';

import {
  ASKELL_API_BASE_URLS,
  AskellEnvSchema,
  ConfigSchema,
  MutationGateSchema,
  PRODUCTION_API_BASE_URL,
  SANDBOX_API_BASE_URL,
  classifyAskellHost,
  normalizeBaseUrl,
  resolveAskellTarget,
} from './config.ts';

describe('ConfigSchema', () => {
  test('defaults to production host from ASKELL_ENV', () => {
    const parsed = ConfigSchema.parse({ secretApiKey: 'secret.key' });
    expect(parsed.askellEnv).toBe('production');
    expect(parsed.apiBaseUrl).toBe(PRODUCTION_API_BASE_URL);
    expect(parsed.responseMaxBytes).toBe(64_000);
    expect(parsed.mutationGate).toBe('auto');
    expect(parsed.publicApiKey).toBeUndefined();
  });

  test('ASKELL_ENV=sandbox selects the sandbox host', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      askellEnv: 'sandbox',
    });
    expect(parsed.askellEnv).toBe('sandbox');
    expect(parsed.apiBaseUrl).toBe(SANDBOX_API_BASE_URL);
  });

  test('accepts prod as an alias for production', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      askellEnv: 'prod',
    });
    expect(parsed.askellEnv).toBe('production');
    expect(parsed.apiBaseUrl).toBe(PRODUCTION_API_BASE_URL);
  });

  test('rejects unknown ASKELL_ENV', () => {
    expect(
      ConfigSchema.safeParse({ secretApiKey: 'secret.key', askellEnv: 'staging' })
        .success,
    ).toBe(false);
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

  test('accepts localhost and loopback HTTP URLs as custom', () => {
    const local = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'http://localhost:8000/api',
    });
    expect(local.askellEnv).toBe('custom');
    expect(local.apiBaseUrl).toBe('http://localhost:8000/api');

    const loopback = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      apiBaseUrl: 'http://127.0.0.1:8000',
    });
    expect(loopback.askellEnv).toBe('custom');
    expect(loopback.apiBaseUrl).toBe('http://127.0.0.1:8000');
  });

  test('classifies ASKELL_API_BASE_URL of an official host when ASKELL_ENV is omitted', () => {
    const parsed = ConfigSchema.parse({
      secretApiKey: 'secret.key',
      apiBaseUrl: `${SANDBOX_API_BASE_URL}/`,
    });
    expect(parsed.askellEnv).toBe('sandbox');
    expect(parsed.apiBaseUrl).toBe(SANDBOX_API_BASE_URL);
  });

  test('rejects ASKELL_ENV that disagrees with ASKELL_API_BASE_URL', () => {
    const result = ConfigSchema.safeParse({
      secretApiKey: 'secret.key',
      askellEnv: 'sandbox',
      apiBaseUrl: PRODUCTION_API_BASE_URL,
    });
    expect(result.success).toBe(false);
  });

  test('rejects ASKELL_ENV together with a custom ASKELL_API_BASE_URL', () => {
    const result = ConfigSchema.safeParse({
      secretApiKey: 'secret.key',
      askellEnv: 'sandbox',
      apiBaseUrl: 'http://localhost:8000/api',
    });
    expect(result.success).toBe(false);
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
      askellEnv: 'sandbox',
      responseMaxBytes: 10_000,
      mutationGate: false,
    });
    expect(parsed.publicApiKey).toBe('public.key');
    expect(parsed.askellEnv).toBe('sandbox');
    expect(parsed.apiBaseUrl).toBe(SANDBOX_API_BASE_URL);
    expect(parsed.responseMaxBytes).toBe(10_000);
    expect(parsed.mutationGate).toBe('off');
  });
});

describe('AskellEnvSchema', () => {
  test('accepts production and sandbox', () => {
    expect(AskellEnvSchema.parse('production')).toBe('production');
    expect(AskellEnvSchema.parse('sandbox')).toBe('sandbox');
    expect(AskellEnvSchema.parse(' Production ')).toBe('production');
  });
});

describe('resolveAskellTarget', () => {
  test('maps official envs to stable hosts', () => {
    expect(resolveAskellTarget({})).toEqual({
      askellEnv: 'production',
      apiBaseUrl: ASKELL_API_BASE_URLS.production,
    });
    expect(resolveAskellTarget({ askellEnv: 'sandbox' })).toEqual({
      askellEnv: 'sandbox',
      apiBaseUrl: ASKELL_API_BASE_URLS.sandbox,
    });
  });

  test('classifies official URLs', () => {
    expect(classifyAskellHost(`${SANDBOX_API_BASE_URL}///`)).toBe('sandbox');
    expect(classifyAskellHost('http://127.0.0.1:8000/api')).toBe('custom');
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
