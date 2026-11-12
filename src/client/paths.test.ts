import { describe, expect, test } from "bun:test";

import { normalizeApiPath, openApiPathMatches } from "./paths.ts";

describe("normalizeApiPath", () => {
  test("adds leading and trailing slash", () => {
    expect(normalizeApiPath("customers")).toBe("/customers/");
  });

  test("keeps leading slash and adds trailing", () => {
    expect(normalizeApiPath("/customers")).toBe("/customers/");
  });

  test("keeps already-normalized path", () => {
    expect(normalizeApiPath("/customers/")).toBe("/customers/");
  });

  test("root stays root", () => {
    expect(normalizeApiPath("/")).toBe("/");
  });

  test("strips redundant leading /api prefix copied from prose docs", () => {
    expect(normalizeApiPath("/api/v2/claim-rules/")).toBe("/v2/claim-rules/");
    expect(normalizeApiPath("api/payments/123/cancel")).toBe(
      "/payments/123/cancel/",
    );
    expect(normalizeApiPath("/api")).toBe("/");
    expect(normalizeApiPath("/api/")).toBe("/");
  });

  test("rejects full URLs and inline query/hash fragments", () => {
    expect(() =>
      normalizeApiPath("https://askell.is/api/v2/claim-rules/"),
    ).toThrow(/relative to apiBaseUrl/i);
    expect(() => normalizeApiPath("//evil.example/v2/")).toThrow(
      /relative to apiBaseUrl/i,
    );
    expect(() =>
      normalizeApiPath("/v2/subscription-contracts/?reference=ord-1"),
    ).toThrow(/query/i);
    expect(() => normalizeApiPath("/customers/#section")).toThrow(/query/i);
  });

  test("matches OpenAPI templates to concrete paths", () => {
    expect(
      openApiPathMatches(
        "/subscriptions/{subscriptionId}/apply-code/",
        "/subscriptions/42/apply-code/",
      ),
    ).toBe(true);
    expect(
      openApiPathMatches("/subscriptions/", "/subscriptions/42/apply-code/"),
    ).toBe(false);
    expect(
      openApiPathMatches(
        "/subscriptions/{subscriptionId}/discount/",
        "/subscriptions/{subscriptionId}/apply-code/",
      ),
    ).toBe(false);
  });

  test("v2 paths keep prefix", () => {
    expect(normalizeApiPath("v2/billing-runs")).toBe("/v2/billing-runs/");
    expect(normalizeApiPath("/v2/subscription-contracts/")).toBe(
      "/v2/subscription-contracts/",
    );
  });
});
