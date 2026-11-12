import v1Spec from "../../spec/openapi-v1.json";
import v2Spec from "../../spec/openapi-v2.json";

import { isRecord } from "../is-record.ts";
import type {
  ApiKeyKind,
  ApiOperation,
  ApiResponseSummary,
  ApiVersion,
  HttpMethod,
  OpenApiDocument,
  OpenApiParameter,
  OpenApiResponseObject,
} from "./types.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head"] as const;

function resolveRef(
  doc: OpenApiDocument,
  ref: string,
  seen = new Set<string>(),
): unknown {
  if (!ref.startsWith("#/")) {
    return ref;
  }

  if (seen.has(ref)) {
    return { $ref: ref, circular: true };
  }

  seen.add(ref);
  const parts = ref.slice(2).split("/");
  let current: unknown = doc;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return ref;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (
    current != null &&
    typeof current === "object" &&
    "$ref" in current &&
    typeof (current as { $ref: unknown }).$ref === "string"
  ) {
    return resolveRef(doc, (current as { $ref: string }).$ref, seen);
  }

  return current;
}

function resolveSchema(doc: OpenApiDocument, schema: unknown): unknown {
  if (schema == null || typeof schema !== "object") {
    return schema;
  }

  if ("$ref" in schema && typeof schema.$ref === "string") {
    return resolveRef(doc, schema.$ref);
  }

  return schema;
}

/**
 * Follow nested `$ref`s in a schema. `seen` is the ancestor chain only, so the
 * same component used twice as a sibling is inlined twice; a cycle stops.
 */
function resolveSchemaDeep(
  doc: OpenApiDocument,
  schema: unknown,
  seen = new Set<string>(),
): unknown {
  if (schema == null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveSchemaDeep(doc, item, seen));
  }

  const record = schema as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    if (record.circular === true || seen.has(record.$ref)) {
      return { $ref: record.$ref, circular: true };
    }

    const next = new Set(seen);
    next.add(record.$ref);
    return resolveSchemaDeep(doc, resolveRef(doc, record.$ref), next);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] =
      value !== null && typeof value === "object"
        ? resolveSchemaDeep(doc, value, seen)
        : value;
  }
  return out;
}

function resolveRequestBody(
  doc: OpenApiDocument,
  requestBody: {
    $ref?: string;
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: unknown }>;
  },
): ApiOperation["requestBody"] {
  let source = requestBody;

  if (typeof requestBody.$ref === "string") {
    const resolved = resolveRef(doc, requestBody.$ref);
    if (
      resolved == null ||
      typeof resolved !== "object" ||
      Array.isArray(resolved)
    ) {
      return { contentTypes: [] };
    }
    source = resolved as typeof requestBody;
  }

  const content = source.content ?? {};
  const contentTypes = Object.keys(content);
  const firstContent = contentTypes[0] ? content[contentTypes[0]] : undefined;

  return {
    ...(source.required !== undefined ? { required: source.required } : {}),
    ...(source.description !== undefined
      ? { description: source.description }
      : {}),
    contentTypes,
    ...(firstContent?.schema !== undefined
      ? { schema: resolveSchemaDeep(doc, firstContent.schema) }
      : {}),
  };
}

function extractErrorCodes(
  doc: OpenApiDocument,
  schema: unknown,
  seen = new Set<string>(),
): string[] {
  if (!isRecord(schema)) {
    return [];
  }

  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) {
      return [];
    }
    const next = new Set(seen);
    next.add(schema.$ref);
    return extractErrorCodes(doc, resolveRef(doc, schema.$ref), next);
  }

  const codes = new Set<string>();
  const properties = isRecord(schema.properties)
    ? schema.properties
    : undefined;
  const codePropRaw = properties?.code;
  const codeProp =
    isRecord(codePropRaw) && typeof codePropRaw.$ref === "string"
      ? resolveRef(doc, codePropRaw.$ref)
      : codePropRaw;

  if (isRecord(codeProp) && Array.isArray(codeProp.enum)) {
    for (const entry of codeProp.enum) {
      if (typeof entry === "string" && entry.length > 0) {
        codes.add(entry);
      }
    }
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        for (const code of extractErrorCodes(doc, branch, seen)) {
          codes.add(code);
        }
      }
    }
  }

  return [...codes];
}

function summarizeSchemaRef(schema: unknown): string | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }

  if (typeof schema.$ref === "string") {
    return schema.$ref;
  }

  if (
    schema.type === "array" &&
    isRecord(schema.items) &&
    typeof schema.items.$ref === "string"
  ) {
    return `array<${schema.items.$ref}>`;
  }

  const refs = new Set<string>();
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const ref = summarizeSchemaRef(branch);
      if (ref) refs.add(ref);
    }
  }

  if (refs.size > 0) {
    return [...refs].join(" | ");
  }

  return undefined;
}

function resolveResponses(
  doc: OpenApiDocument,
  responses: Record<string, OpenApiResponseObject> | undefined,
): Record<string, ApiResponseSummary> | undefined {
  if (!responses || Object.keys(responses).length === 0) {
    return undefined;
  }

  const out: Record<string, ApiResponseSummary> = {};

  for (const [status, rawResponse] of Object.entries(responses)) {
    let source: OpenApiResponseObject = rawResponse;
    if (typeof rawResponse.$ref === "string") {
      const resolved = resolveRef(doc, rawResponse.$ref);
      if (isRecord(resolved)) {
        source = resolved as OpenApiResponseObject;
      }
    }

    const content = source.content ?? {};
    const contentTypes = Object.keys(content);
    const firstSchema = contentTypes[0]
      ? content[contentTypes[0]]?.schema
      : undefined;
    const schemaRef = summarizeSchemaRef(firstSchema);
    const isErrorStatus = status.startsWith("4") || status.startsWith("5");
    const errorCodes = isErrorStatus ? extractErrorCodes(doc, firstSchema) : [];

    out[status] = {
      ...(source.description !== undefined
        ? { description: source.description }
        : {}),
      ...(contentTypes.length > 0 ? { contentTypes } : {}),
      ...(schemaRef !== undefined ? { schemaRef } : {}),
      ...(errorCodes.length > 0 ? { errorCodes } : {}),
    };
  }

  return out;
}

function resolveParameters(
  doc: OpenApiDocument,
  parameters: OpenApiParameter[] | undefined,
): OpenApiParameter[] {
  if (!parameters?.length) {
    return [];
  }

  return parameters.map((parameter) => {
    let source: OpenApiParameter = parameter;

    if ("$ref" in parameter && typeof parameter.$ref === "string") {
      const resolved = resolveRef(doc, parameter.$ref);
      if (resolved && typeof resolved === "object") {
        source = resolved as OpenApiParameter;
      }
    }

    // Pick known fields only — OpenAPI params often include style/explode/example,
    // which MCP outputSchema rejects (additionalProperties: false).
    return {
      ...(source.name !== undefined
        ? { name: parameter.name ?? source.name }
        : {}),
      ...(source.in !== undefined ? { in: source.in } : {}),
      ...(source.required !== undefined ? { required: source.required } : {}),
      ...(source.description !== undefined
        ? { description: source.description }
        : {}),
      ...(source.schema !== undefined
        ? { schema: resolveSchema(doc, source.schema) }
        : {}),
      ...(source.$ref !== undefined && source.name === undefined
        ? { $ref: source.$ref }
        : {}),
    };
  });
}

function inferApiKeyKind(
  security: Array<Record<string, unknown[]>> | undefined,
): ApiKeyKind {
  // Omitted `security` inherits the document default (secret key).
  // `security: []` opts out of every scheme — no API key.
  if (security === undefined) {
    return "secret";
  }

  if (security.length === 0) {
    return "none";
  }

  for (const requirement of security) {
    if ("Public-Api-Key" in requirement) {
      return "public";
    }
  }

  return "secret";
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
          ? resolveRequestBody(doc, operation.requestBody)
          : undefined,
        responses: resolveResponses(doc, operation.responses),
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
      ...parseDocument(v1Spec as unknown as OpenApiDocument, "v1"),
      ...parseDocument(v2Spec as unknown as OpenApiDocument, "v2"),
    ];
  }

  getById(id: string): ApiOperation | undefined {
    return this.operations.find((operation) => operation.id === id);
  }

  find(filters: {
    apiVersion?: ApiVersion | "all";
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
        filters.apiVersion !== "all" &&
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
        const responseErrorCodes = Object.values(operation.responses ?? {})
          .flatMap((res) => res.errorCodes ?? [])
          .join(" ");

        const haystack = [
          operation.id,
          operation.path,
          operation.summary,
          operation.description ?? "",
          operation.tags.join(" "),
          responseErrorCodes,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }

  listTags(apiVersion?: ApiVersion | "all"): string[] {
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
  return apiVersion === "v1"
    ? (v1Spec as unknown as OpenApiDocument)
    : (v2Spec as unknown as OpenApiDocument);
}
