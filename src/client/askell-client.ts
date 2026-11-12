import { normalizeBaseUrl, type AppConfig } from "../config.ts";
import { normalizeApiPath } from "./paths.ts";
import { redactSecretsInText } from "./redact.ts";
import {
  buildBoundedListPayload,
  formatApiResponse,
  isMutatingMethod,
  type FormattedResponse,
} from "./response-formatter.ts";

import type { ApiKeyKind } from "../openapi/types.ts";

export interface AskellRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  apiKeyKind?: ApiKeyKind;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function appendQueryParams(url: URL, query?: Record<string, unknown>): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

export class AskellClient {
  private readonly baseUrl: string;
  private readonly baseOrigin: string;
  private readonly baseProtocol: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = normalizeBaseUrl(config.apiBaseUrl);
    const parsedBase = new URL(this.baseUrl);
    this.baseOrigin = parsedBase.origin;
    this.baseProtocol = parsedBase.protocol;
  }

  private authorizationHeader(
    kind: ApiKeyKind | undefined,
  ): Record<string, string> {
    const apiKeyKind = kind ?? "secret";
    if (apiKeyKind === "none") {
      return {};
    }

    const apiKey =
      apiKeyKind === "public"
        ? this.config.publicApiKey
        : this.config.secretApiKey;

    if (!apiKey) {
      throw new Error(
        apiKeyKind === "public"
          ? "publicApiKey is not configured"
          : "secretApiKey is not configured",
      );
    }

    return { Authorization: `Api-Key ${apiKey}` };
  }

  private resolveSafeNextUrl(next: string): URL {
    const candidate = new URL(next, `${this.baseUrl}/`);
    if (
      candidate.origin !== this.baseOrigin ||
      candidate.protocol !== this.baseProtocol
    ) {
      throw new Error(
        `Refusing cross-origin or protocol-downgraded pagination URL: ${candidate.origin}`,
      );
    }
    return candidate;
  }

  async request(
    input: AskellRequest,
  ): Promise<FormattedResponse & { ok: boolean; status: number }> {
    const method = input.method.toUpperCase();
    const path = normalizeApiPath(input.path);
    const url = new URL(`${this.baseUrl}${path}`);
    appendQueryParams(url, input.query);

    const authorization = this.authorizationHeader(input.apiKeyKind);

    const started = performance.now();
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...authorization,
        ...(input.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...input.headers,
      },
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: input.signal,
    });

    const bodyText = await response.text();
    const formatted = formatApiResponse(
      response.status,
      response.headers,
      bodyText,
      this.config.responseMaxBytes,
      {
        method,
        url: url.toString(),
        durationMs: Math.round(performance.now() - started),
        mutating: isMutatingMethod(method),
      },
    );

    return {
      ...formatted,
      ok: response.ok,
      status: response.status,
    };
  }

  async paginateAll(input: {
    path: string;
    query?: Record<string, unknown>;
    apiKeyKind?: ApiKeyKind;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<FormattedResponse & { ok: boolean; status: number }> {
    const maxPages = input.maxPages ?? 20;
    const authorization = this.authorizationHeader(input.apiKeyKind);

    const collected: unknown[] = [];
    let nextUrl: URL | null = null;
    let page = 0;
    let lastStatus = 200;

    const buildInitialUrl = (): URL => {
      const path = normalizeApiPath(input.path);
      const url = new URL(`${this.baseUrl}${path}`);
      appendQueryParams(url, input.query);
      return url;
    };

    do {
      page += 1;
      const url = nextUrl ?? buildInitialUrl();
      const started = performance.now();

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authorization,
        },
        signal: input.signal,
      });

      lastStatus = response.status;
      const bodyText = await response.text();

      if (!response.ok) {
        return {
          ...formatApiResponse(
            response.status,
            response.headers,
            bodyText,
            this.config.responseMaxBytes,
            {
              method: "GET",
              url: url.toString(),
              durationMs: Math.round(performance.now() - started),
              mutating: false,
            },
          ),
          ok: false,
          status: response.status,
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        const text = redactSecretsInText(bodyText);
        return {
          text,
          truncated: false,
          byteLength: Buffer.byteLength(text, "utf8"),
          ok: false,
          status: lastStatus,
        };
      }

      if (Array.isArray(parsed)) {
        collected.push(...parsed);
        nextUrl = null;
      } else if (
        parsed &&
        typeof parsed === "object" &&
        "results" in parsed &&
        Array.isArray((parsed as { results: unknown[] }).results)
      ) {
        const pageBody = parsed as {
          results: unknown[];
          next?: string | null;
        };
        collected.push(...pageBody.results);
        nextUrl = pageBody.next ? this.resolveSafeNextUrl(pageBody.next) : null;
      } else {
        const rawBody = JSON.stringify(parsed, null, 2);

        return {
          ...formatApiResponse(
            lastStatus,
            response.headers,
            rawBody,
            this.config.responseMaxBytes,
            {
              pagesFetched: page,
              note: "Response is not a paginated list; returning raw body",
            },
          ),
          ok: true,
          status: lastStatus,
        };
      }
    } while (nextUrl && page < maxPages);

    return {
      ...buildBoundedListPayload({
        status: lastStatus,
        meta: {
          pagesFetched: page,
          truncatedByMaxPages: Boolean(nextUrl),
        },
        items: collected,
        maxBytes: this.config.responseMaxBytes,
      }),
      ok: true,
      status: lastStatus,
    };
  }
}
