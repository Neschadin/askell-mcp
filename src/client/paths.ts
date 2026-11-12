/** OpenAPI `{param}` template vs a concrete request path. Both should be normalized. */
export function openApiPathMatches(template: string, concrete: string): boolean {
  if (template === concrete) {
    return true;
  }

  const templateParts = template.split('/');
  const concreteParts = concrete.split('/');
  if (templateParts.length !== concreteParts.length) {
    return false;
  }

  return templateParts.every((part, index) => {
    if (part.startsWith('{') && part.endsWith('}') && part.length > 2) {
      return concreteParts[index] !== '';
    }
    return part === concreteParts[index];
  });
}

/**
 * Normalize Askell API paths: leading slash + trailing slash (OpenAPI convention).
 * Strips a redundant leading `/api/` prefix (since `apiBaseUrl` already ends in `/api`),
 * and rejects full URLs or inline query/hash fragments so query strings are never
 * silently corrupted with a trailing slash.
 */
export function normalizeApiPath(rawPath: string): string {
  const trimmed = rawPath.trim();

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(
      `Expected an API path relative to apiBaseUrl, got full URL: ${rawPath}`,
    );
  }

  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error(
      `Pass query parameters in the "query" object rather than inside "path": ${rawPath}`,
    );
  }

  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  if (normalized === '/api' || normalized.startsWith('/api/')) {
    normalized = normalized.slice(4) || '/';
  }

  if (normalized !== '/' && !normalized.endsWith('/')) {
    normalized += '/';
  }

  return normalized;
}
