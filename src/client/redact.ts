const SECRET_KEYS = new Set(['hmac_secret']);

const JSON_SECRET_STRING =
  /"(hmac_secret)"\s*:\s*("(?:\\.|[^"\\])*")/g;

export function formatRedactedSecret(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('<redacted')) {
    return value;
  }
  if (typeof value === 'string') {
    return `<redacted len=${value.length}>`;
  }
  return '<redacted>';
}

export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = SECRET_KEYS.has(key)
        ? formatRedactedSecret(nested)
        : redactSensitiveFields(nested);
    }
    return out;
  }

  return value;
}

/** Fallback for non-JSON / truncated bodies. Leaves already-redacted values alone. */
export function redactSecretsInText(text: string): string {
  if (!text.includes('hmac_secret')) {
    return text;
  }

  try {
    return JSON.stringify(redactSensitiveFields(JSON.parse(text)));
  } catch {
    JSON_SECRET_STRING.lastIndex = 0;
    return text.replace(JSON_SECRET_STRING, (_match, key: string, raw: string) => {
      try {
        return `"${key}": ${JSON.stringify(formatRedactedSecret(JSON.parse(raw)))}`;
      } catch {
        return `"${key}": ${JSON.stringify(formatRedactedSecret(undefined))}`;
      }
    });
  }
}
