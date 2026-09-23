/**
 * Overlay for Askell OpenAPI v1. Upstream swagger is wrong in a few places;
 * this is the same transform as askell_client_v1 `patchAskellSpec` (without Orval).
 *
 * Idempotent: safe to run on an already-patched document.
 */

import { isRecord } from '../is-record.ts';

type JsonSchema = Record<string, unknown>;
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type OpenApiResponse = {
  description?: string;
  content?: Record<string, { schema?: JsonSchema }>;
  [key: string]: unknown;
};

type OpenApiOperation = {
  tags?: string[];
  responses?: Record<string, OpenApiResponse>;
  [key: string]: unknown;
};

type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>> & {
  [key: string]: unknown;
};

type OpenApiDocument = {
  info?: Record<string, unknown>;
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export const ASKELL_V1_PATCH = 'v1-overlay-1';
export const WEBHOOK_CALLS_TAG = 'Webhook calls';

/** Success bodies missing from swagger `content` (DELETE 204 stays empty). */
const RESPONSE_BODIES = [
  ['/customers/', 'post', '201', 'Customer'],
  ['/customers/{customerReference}/', 'put', '200', 'Customer'],
  ['/customers/{customerReference}/', 'patch', '200', 'Customer'],
  ['/webhooks/', 'post', '201', 'Webhook'],
  ['/webhooks/{id}/', 'patch', '200', 'Webhook'],
] as const satisfies ReadonlyArray<
  readonly [string, HttpMethod, string, string]
>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

const nullableString = (maxLength?: number): JsonSchema => ({
  type: 'string',
  nullable: true,
  ...(maxLength === undefined ? {} : { maxLength }),
});

/** Flattened + nested address as returned by GET /customers/ and customer.* webhooks. */
const CUSTOMER_ADDRESS_SCHEMA: JsonSchema = {
  type: 'object',
  required: [
    'delivery_name',
    'address_1',
    'address_2',
    'address_3',
    'zip_code',
    'city',
    'country',
  ],
  properties: {
    delivery_name: nullableString(),
    address_1: nullableString(),
    address_2: nullableString(),
    address_3: nullableString(),
    zip_code: nullableString(),
    city: nullableString(),
    country: nullableString(),
  },
};

/**
 * Askell swagger reuses CustomerCreate (write) as the GET model via allOf.
 * Live GET / webhooks return extra address fields, null emails/phones, and a
 * required numeric id. Keep CustomerCreate as the POST body.
 */
const CUSTOMER_READ_SCHEMA: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'first_name',
    'last_name',
    'email',
    'customer_reference',
    'phone',
    'delivery_name',
    'address_1',
    'address_2',
    'address_3',
    'zip_code',
    'city',
    'country',
    'payment_method',
    'address',
  ],
  properties: {
    id: { type: 'integer', format: 'int64' },
    first_name: { type: 'string', maxLength: 128 },
    last_name: { type: 'string', maxLength: 128 },
    email: nullableString(254),
    phone: nullableString(32),
    customer_reference: { type: 'string', maxLength: 256 },
    delivery_name: nullableString(),
    address_1: nullableString(),
    address_2: nullableString(),
    address_3: nullableString(),
    zip_code: nullableString(),
    city: nullableString(),
    country: nullableString(),
    payment_method: {
      type: 'array',
      items: { $ref: '#/components/schemas/PaymentMethod' },
    },
    address: {
      allOf: [{ $ref: '#/components/schemas/CustomerAddress' }],
      nullable: true,
    },
  },
};

function dropWebhookCallOperations(doc: OpenApiDocument): void {
  const paths = doc.paths;
  if (!paths) {
    return;
  }

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!pathItem) {
      continue;
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method as HttpMethod];
      if (operation?.tags?.includes(WEBHOOK_CALLS_TAG)) {
        delete pathItem[method as HttpMethod];
      }
    }

    const remaining = HTTP_METHODS.some(
      (method) => pathItem[method as HttpMethod] != null,
    );
    if (!remaining) {
      delete paths[path];
    }
  }

  if (doc.tags) {
    doc.tags = doc.tags.filter((tag) => tag.name !== WEBHOOK_CALLS_TAG);
  }
}

function ensureResponseBody(
  doc: OpenApiDocument,
  path: string,
  method: HttpMethod,
  status: string,
  schemaName: string,
): void {
  const pathItem = doc.paths?.[path];
  const operation = pathItem?.[method];
  const response = operation?.responses?.[status];
  const label = `${method.toUpperCase()} ${path} ${status}`;

  if (!pathItem || !operation || !response) {
    throw new Error(`Askell spec missing ${label}`);
  }

  if (response.content?.['application/json']?.schema) {
    return;
  }

  response.content = {
    ...response.content,
    'application/json': {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  };
}

export function patchAskellV1Spec(spec: unknown): OpenApiDocument {
  if (!isRecord(spec)) {
    throw new Error('Askell v1 spec is not an object');
  }

  const doc = structuredClone(spec) as OpenApiDocument;
  const schemas = doc.components?.schemas;
  if (!schemas?.Customer) {
    throw new Error('Askell spec missing components.schemas.Customer');
  }
  if (!schemas.Webhook) {
    throw new Error('Askell spec missing components.schemas.Webhook');
  }

  dropWebhookCallOperations(doc);

  doc.components = {
    ...doc.components,
    schemas: {
      ...schemas,
      CustomerAddress: CUSTOMER_ADDRESS_SCHEMA,
      Customer: CUSTOMER_READ_SCHEMA,
    },
  };

  for (const [path, method, status, schemaName] of RESPONSE_BODIES) {
    ensureResponseBody(doc, path, method, status, schemaName);
  }

  doc.info = {
    ...doc.info,
    'x-askell-mcp-patched': ASKELL_V1_PATCH,
  };

  return doc;
}
