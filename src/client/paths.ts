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

/** Normalize Askell API paths: leading slash + trailing slash (OpenAPI convention). */
export function normalizeApiPath(path: string): string {
  let normalized = path.startsWith('/') ? path : `/${path}`;

  if (normalized !== '/' && !normalized.endsWith('/')) {
    normalized += '/';
  }

  return normalized;
}
