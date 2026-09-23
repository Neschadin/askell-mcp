import {
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
} from '@modelcontextprotocol/server';

import type { MutationGate } from '../config.ts';
import { isRecord } from '../is-record.ts';

export type MutationGateDecision = { action: 'execute' } | { action: 'elicit' };

/**
 * Per-request client capabilities (protocol 2026-07-28).
 *
 * Source of truth is `ctx.mcpReq.envelope[CLIENT_CAPABILITIES_META_KEY]` —
 * reserved `io.modelcontextprotocol/*` keys are lifted out of `_meta` before
 * the handler runs. Do not use deprecated `Server.getClientCapabilities()`:
 * on 2026 stdio (`serveStdio` factory) it is always undefined (no `initialize`).
 *
 * 2025-era clients do not send this envelope; `undefined` here means "this
 * request did not declare elicitation", so `auto` falls through to the
 * client's own tool-allow UI.
 *
 * @see https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.md
 */
export function readClientCapabilities(
  envelope: unknown,
): ClientCapabilities | undefined {
  if (!isRecord(envelope)) return undefined;

  const value = envelope[CLIENT_CAPABILITIES_META_KEY];
  return isRecord(value) ? (value as ClientCapabilities) : undefined;
}

/** Form-mode elicitation: `elicitation: {}` (pre-mode) or `elicitation.form`. URL-only is not form. */
export function clientSupportsFormElicitation(
  capabilities: ClientCapabilities | undefined,
): boolean {
  const elicitation = capabilities?.elicitation;
  if (elicitation == null) return false;
  if (elicitation.form != null) return true;

  const keys = Object.keys(elicitation);
  if (elicitation.url != null && keys.every((key) => key === 'url'))
    return false;

  return true;
}

/**
 * auto  — elicit only if this request's envelope declared form elicitation.
 * elicit — always return inputRequired; the SDK era-gates the wire
 *          (2026 envelope / 2025 initialize via the legacy shim).
 * off   — never elicit.
 */
export function decideMutationGate(options: {
  gate: MutationGate;
  alreadyConfirmed: boolean;
  supportsFormElicitation: boolean;
}): MutationGateDecision {
  if (options.alreadyConfirmed || options.gate === 'off') {
    return { action: 'execute' };
  }
  if (options.gate === 'elicit' || options.supportsFormElicitation) {
    return { action: 'elicit' };
  }
  return { action: 'execute' };
}
