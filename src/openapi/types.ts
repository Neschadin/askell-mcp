export type ApiVersion = 'v1' | 'v2';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type ApiKeyKind = 'secret' | 'public';

export interface OpenApiParameter {
  name?: string;
  in?: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: unknown;
  $ref?: string;
}

export interface ApiOperation {
  id: string;
  apiVersion: ApiVersion;
  method: HttpMethod;
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  parameters: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    contentTypes: string[];
    schema?: unknown;
  };
  apiKeyKind: ApiKeyKind;
  deprecated?: boolean;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths?: Record<
    string,
    Partial<
      Record<
        Lowercase<HttpMethod>,
        {
          tags?: string[];
          summary?: string;
          description?: string;
          deprecated?: boolean;
          parameters?: OpenApiParameter[];
          requestBody?: {
            required?: boolean;
            description?: string;
            content?: Record<string, { schema?: unknown }>;
          };
          security?: Array<Record<string, unknown[]>>;
        }
      >
    >
  >;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
}
