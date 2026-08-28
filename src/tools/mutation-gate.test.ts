import { describe, expect, test } from 'bun:test';

import {
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
} from '@modelcontextprotocol/server';

import {
  clientSupportsFormElicitation,
  decideMutationGate,
  readClientCapabilities,
} from './mutation-gate.ts';

describe('clientSupportsFormElicitation', () => {
  test('false when capabilities missing or elicitation undeclared', () => {
    expect(clientSupportsFormElicitation(undefined)).toBe(false);
    expect(clientSupportsFormElicitation({})).toBe(false);
    expect(clientSupportsFormElicitation({ experimental: {} })).toBe(false);
  });

  test('true for empty elicitation object (pre-mode form)', () => {
    expect(
      clientSupportsFormElicitation({ elicitation: {} } as ClientCapabilities),
    ).toBe(true);
  });

  test('true when form mode is declared', () => {
    expect(
      clientSupportsFormElicitation({
        elicitation: { form: {} },
      } as ClientCapabilities),
    ).toBe(true);
    expect(
      clientSupportsFormElicitation({
        elicitation: { form: {}, url: {} },
      } as ClientCapabilities),
    ).toBe(true);
  });

  test('false for URL-only elicitation', () => {
    expect(
      clientSupportsFormElicitation({
        elicitation: { url: {} },
      } as ClientCapabilities),
    ).toBe(false);
  });
});

describe('readClientCapabilities', () => {
  test('reads io.modelcontextprotocol/clientCapabilities from the envelope', () => {
    const caps = { elicitation: { form: {} } };
    expect(
      readClientCapabilities({ [CLIENT_CAPABILITIES_META_KEY]: caps }),
    ).toEqual(caps);
  });

  test('ignores lifted-out _meta bags and missing envelopes', () => {
    expect(readClientCapabilities(undefined)).toBeUndefined();
    expect(readClientCapabilities({})).toBeUndefined();
    expect(readClientCapabilities({ elicitation: { form: {} } })).toBeUndefined();
  });
});

describe('decideMutationGate', () => {
  test('off always executes', () => {
    expect(
      decideMutationGate({
        gate: 'off',
        alreadyConfirmed: false,
        supportsFormElicitation: true,
      }),
    ).toEqual({ action: 'execute' });
  });

  test('already confirmed executes even in elicit mode', () => {
    expect(
      decideMutationGate({
        gate: 'elicit',
        alreadyConfirmed: true,
        supportsFormElicitation: false,
      }),
    ).toEqual({ action: 'execute' });
  });

  test('auto elicits only when this request declared form elicitation', () => {
    expect(
      decideMutationGate({
        gate: 'auto',
        alreadyConfirmed: false,
        supportsFormElicitation: true,
      }),
    ).toEqual({ action: 'elicit' });
    expect(
      decideMutationGate({
        gate: 'auto',
        alreadyConfirmed: false,
        supportsFormElicitation: false,
      }),
    ).toEqual({ action: 'execute' });
  });

  test('elicit always asks; SDK era-gates the wire', () => {
    expect(
      decideMutationGate({
        gate: 'elicit',
        alreadyConfirmed: false,
        supportsFormElicitation: false,
      }),
    ).toEqual({ action: 'elicit' });
    expect(
      decideMutationGate({
        gate: 'elicit',
        alreadyConfirmed: false,
        supportsFormElicitation: true,
      }),
    ).toEqual({ action: 'elicit' });
  });
});
