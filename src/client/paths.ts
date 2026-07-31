/** Normalize Askell API paths: leading slash + trailing slash (OpenAPI convention). */
export function normalizeApiPath(path: string): string {
  let normalized = path.startsWith('/') ? path : `/${path}`;

  if (normalized !== '/' && !normalized.endsWith('/')) {
    normalized += '/';
  }

  return normalized;
}
