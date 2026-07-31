import v1Spec from '../../spec/openapi-v1.json';
import v2Spec from '../../spec/openapi-v2.json';

import type {
  ApiKeyKind,
  ApiOperation,
  ApiVersion,
  HttpMethod,
  OpenApiDocument,
  OpenApiParameter,
} from './types.ts';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

function resolveRef(
  doc: OpenApiDocument,
  ref: string,
  seen = new Set<string>(),
): unknown {
  if (!ref.startsWith('#/')) {
    return ref;
  }

  if (seen.has(ref)) {
    return { $ref: ref, circular: true };
  }

  seen.add(ref);
  const parts = ref.slice(2).split('/');
  let current: unknown = doc;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return ref;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (
    current != null &&
    typeof current === 'object' &&
    '$ref' in current &&
    typeof (current as { $ref: unknown }).$ref === 'string'
  ) {
    return resolveRef(doc, (current as { $ref: string }).$ref, seen);
  }

  return current;
}

function resolveSchema(doc: OpenApiDocument, schema: unknown): unknown {
  if (schema == null || typeof schema !== 'object') {
    return schema;
  }

  if ('$ref' in schema && typeof schema.$ref === 'string') {
    return resolveRef(doc, schema.$ref);
  }

  return schema;
}

function resolveParameters(
  doc: OpenApiDocument,
  parameters: OpenApiParameter[] | undefined,
): OpenApiParameter[] {
  if (!parameters?.length) {
    return [];
  }

  return parameters.map((parameter) => {
    if ('$ref' in parameter && typeof parameter.$ref === 'string') {
      const resolved = resolveRef(doc, parameter.$ref);
      if (resolved && typeof resolved === 'object') {
        const param = resolved as OpenApiParameter;
        return {
          ...param,
          schema: resolveSchema(doc, param.schema),
        };
      }
    }

    return {
      ...parameter,
      schema: resolveSchema(doc, parameter.schema),
    };
  });
}

function inferApiKeyKind(
  security: Array<Record<string, unknown[]>> | undefined,
): ApiKeyKind {
  if (!security?.length) {
    return 'secret';
  }

  for (const requirement of security) {
    if ('Public-Api-Key' in requirement) {
      return 'public';
    }
  }

  return 'secret';
}

function buildOperationId(
  apiVersion: ApiVersion,
  method: HttpMethod,
  path: string,
): string {
  return `${apiVersion}:${method}:${path}`;
}

function parseDocument(
  doc: OpenApiDocument,
  apiVersion: ApiVersion,
): ApiOperation[] {
  const operations: ApiOperation[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem) {
      continue;
    }

    for (const methodKey of HTTP_METHODS) {
      const operation = pathItem[methodKey];
      if (!operation) {
        continue;
      }

      const method = methodKey.toUpperCase() as HttpMethod;
      const content = operation.requestBody?.content ?? {};
      const contentTypes = Object.keys(content);
      const firstContent = contentTypes[0]
        ? content[contentTypes[0]]
        : undefined;

      operations.push({
        id: buildOperationId(apiVersion, method, path),
        apiVersion,
        method,
        path,
        tags: operation.tags ?? [],
        summary: operation.summary ?? `${method} ${path}`,
        description: operation.description,
        parameters: resolveParameters(doc, operation.parameters),
        requestBody: operation.requestBody
          ? {
              required: operation.requestBody.required,
              description: operation.requestBody.description,
              contentTypes,
              schema: firstContent
                ? resolveSchema(doc, firstContent.schema)
                : undefined,
            }
          : undefined,
        apiKeyKind: inferApiKeyKind(operation.security),
        deprecated: operation.deprecated,
      });
    }
  }

  return operations;
}

export class OperationRegistry {
  readonly operations: ApiOperation[];

  constructor() {
    this.operations = [
      ...parseDocument(v1Spec as unknown as OpenApiDocument, 'v1'),
      ...parseDocument(v2Spec as unknown as OpenApiDocument, 'v2'),
    ];
  }

  getById(id: string): ApiOperation | undefined {
    return this.operations.find((operation) => operation.id === id);
  }

  find(filters: {
    apiVersion?: ApiVersion | 'all';
    tag?: string;
    method?: HttpMethod;
    pathPrefix?: string;
    search?: string;
    apiKeyKind?: ApiKeyKind;
  }): ApiOperation[] {
    const search = filters.search?.trim().toLowerCase();

    return this.operations.filter((operation) => {
      if (
        filters.apiVersion &&
        filters.apiVersion !== 'all' &&
        operation.apiVersion !== filters.apiVersion
      ) {
        return false;
      }

      if (filters.tag && !operation.tags.includes(filters.tag)) {
        return false;
      }

      if (filters.method && operation.method !== filters.method) {
        return false;
      }

      if (
        filters.pathPrefix &&
        !operation.path.startsWith(filters.pathPrefix)
      ) {
        return false;
      }

      if (filters.apiKeyKind && operation.apiKeyKind !== filters.apiKeyKind) {
        return false;
      }

      if (search) {
        const haystack = [
          operation.id,
          operation.path,
          operation.summary,
          operation.description ?? '',
          operation.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }

  listTags(apiVersion?: ApiVersion | 'all'): string[] {
    const tags = new Set<string>();

    for (const operation of this.find({ apiVersion })) {
      for (const tag of operation.tags) {
        tags.add(tag);
      }
    }

    return [...tags].sort((a, b) => a.localeCompare(b));
  }
}

export const operationRegistry = new OperationRegistry();

export function getBundledSpec(apiVersion: ApiVersion): OpenApiDocument {
  return apiVersion === 'v1'
    ? (v1Spec as unknown as OpenApiDocument)
    : (v2Spec as unknown as OpenApiDocument);
}
