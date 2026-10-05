import { describe, expect, test } from 'bun:test';

import { resolveCallApiKeyKind } from './call.ts';

describe('resolveCallApiKeyKind', () => {
  test('omitted kind follows the operation, including keyless v1 discounts', () => {
    expect(
      resolveCallApiKeyKind(
        'GET',
        '/subscriptions/{subscriptionId}/discount/',
        undefined,
      ),
    ).toBe('none');
    expect(
      resolveCallApiKeyKind('POST', '/subscriptions/42/apply-code', undefined),
    ).toBe('none');
    expect(
      resolveCallApiKeyKind(
        'GET',
        '/temporarypaymentmethod/tok_123/',
        undefined,
      ),
    ).toBe('public');
    expect(resolveCallApiKeyKind('GET', '/customers/', undefined)).toBe(
      'secret',
    );
    expect(
      resolveCallApiKeyKind('POST', '/temporarypaymentmethod/', undefined),
    ).toBe('public');
    expect(resolveCallApiKeyKind('GET', '/not-a-real-path/', undefined)).toBe(
      'secret',
    );
  });

  test('an explicit kind overrides the operation', () => {
    expect(
      resolveCallApiKeyKind(
        'POST',
        '/subscriptions/{subscriptionId}/remove-discount/',
        'secret',
      ),
    ).toBe('secret');
  });
});
