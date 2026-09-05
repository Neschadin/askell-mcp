import { describe, expect, test } from 'bun:test';

import {
  formatRedactedSecret,
  redactSensitiveFields,
  redactSecretsInText,
} from './redact.ts';

describe('formatRedactedSecret', () => {
  test('includes string length', () => {
    expect(formatRedactedSecret('abcd')).toBe('<redacted len=4>');
  });

  test('non-strings have no length', () => {
    expect(formatRedactedSecret(null)).toBe('<redacted>');
    expect(formatRedactedSecret(12)).toBe('<redacted>');
  });

  test('does not double-redact', () => {
    expect(formatRedactedSecret('<redacted len=16>')).toBe('<redacted len=16>');
  });
});

describe('redactSensitiveFields', () => {
  test('redacts hmac_secret on list items', () => {
    const secret = 'plain-hmac-value';
    const out = redactSensitiveFields([
      {
        id: 7,
        event: 'checkout.*',
        url: 'https://example.test/hooks',
        hmac_digest: 'SHA512',
        hmac_secret: secret,
        uuid: 'fc4f3682-d276-4db4-a543-8317aa26e253',
      },
    ]) as Array<Record<string, unknown>>;

    expect(out[0]?.hmac_secret).toBe('<redacted len=16>');
    expect(out[0]?.hmac_digest).toBe('SHA512');
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  test('walks nested objects', () => {
    const out = redactSensitiveFields({
      body: { webhook: { hmac_secret: 'nested-secret' } },
    }) as { body: { webhook: { hmac_secret: string } } };

    expect(out.body.webhook.hmac_secret).toBe('<redacted len=13>');
  });
});

describe('redactSecretsInText', () => {
  test('redacts pretty JSON without parsing as an object first', () => {
    const secret = 'abc"def\\ghi';
    const text = JSON.stringify({ hmac_secret: secret }, null, 2);
    const out = redactSecretsInText(text);
    expect(out).toContain('<redacted len=11>');
    expect(out).not.toContain('def');
  });

  test('redacts invalid JSON via field matcher', () => {
    const secret = 'truncated-secret-value';
    const text = `{"id":1,"hmac_secret":"${secret}","event":"payment.*"`;
    const out = redactSecretsInText(text);
    expect(out).toContain('<redacted len=22>');
    expect(out).not.toContain(secret);
  });

  test('leaves unrelated payloads alone', () => {
    const text = '{"id":1,"event":"payment.changed"}';
    expect(redactSecretsInText(text)).toBe(text);
  });
});
