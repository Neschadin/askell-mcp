import { describe, expect, test } from 'bun:test';

import { normalizeApiPath, openApiPathMatches } from './paths.ts';

describe('normalizeApiPath', () => {
  test('adds leading and trailing slash', () => {
    expect(normalizeApiPath('customers')).toBe('/customers/');
  });

  test('keeps leading slash and adds trailing', () => {
    expect(normalizeApiPath('/customers')).toBe('/customers/');
  });

  test('keeps already-normalized path', () => {
    expect(normalizeApiPath('/customers/')).toBe('/customers/');
  });

  test('root stays root', () => {
    expect(normalizeApiPath('/')).toBe('/');
  });

  test('matches OpenAPI templates to concrete paths', () => {
    expect(
      openApiPathMatches(
        '/subscriptions/{subscriptionId}/apply-code/',
        '/subscriptions/42/apply-code/',
      ),
    ).toBe(true);
    expect(
      openApiPathMatches('/subscriptions/', '/subscriptions/42/apply-code/'),
    ).toBe(false);
    expect(
      openApiPathMatches(
        '/subscriptions/{subscriptionId}/discount/',
        '/subscriptions/{subscriptionId}/apply-code/',
      ),
    ).toBe(false);
  });

  test('v2 paths keep prefix', () => {
    expect(normalizeApiPath('v2/billing-runs')).toBe('/v2/billing-runs/');
    expect(normalizeApiPath('/v2/subscription-contracts/')).toBe(
      '/v2/subscription-contracts/',
    );
  });
});
