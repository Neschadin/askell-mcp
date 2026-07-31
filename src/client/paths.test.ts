import { describe, expect, test } from 'bun:test';

import { normalizeApiPath } from './paths.ts';

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

  test('v2 paths keep prefix', () => {
    expect(normalizeApiPath('v2/billing-runs')).toBe('/v2/billing-runs/');
    expect(normalizeApiPath('/v2/subscription-contracts/')).toBe(
      '/v2/subscription-contracts/',
    );
  });
});
