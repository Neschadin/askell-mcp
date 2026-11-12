import { isRecord } from '../is-record.ts';
import { redactSensitiveFields, redactSecretsInText } from './redact.ts';

export interface FormattedResponse {
  text: string;
  truncated: boolean;
  byteLength: number;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';

  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;

  // Step back across UTF-8 continuation bytes (`10xxxxxx`) so we never split
  // a multibyte code point or surrogate pair.
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) {
    end -= 1;
  }

  return buf.subarray(0, end).toString('utf8');
}

export function limitText(
  text: string,
  maxBytes: number,
): Pick<FormattedResponse, 'text' | 'truncated' | 'byteLength'> {
  const byteLength = Buffer.byteLength(text, 'utf8');
  const truncated = byteLength > maxBytes;

  return {
    text: truncated ? truncateUtf8(text, maxBytes) : text,
    truncated,
    byteLength,
  };
}

function summarizeListItem(item: unknown): unknown {
  if (!isRecord(item)) return item;

  const out: Record<string, unknown> = {};
  const scalarKeys = [
    'id',
    'reference',
    'customer_reference',
    'uuid',
    'name',
    'title',
    'state',
    'status',
    'active',
    'cancelled',
    'start_date',
    'created_at',
    'ended_at',
    'active_until',
    'email',
    'first_name',
    'last_name',
    'currency',
    'amount',
    'total_amount',
    'refunded_amount',
    'refundable_amount',
    'code',
    'valid',
    'duration',
    'coupon',
    'category',
    'bank_account',
    'company_id',
    'due_date_rule',
    'final_due_date_rule',
    'notice_and_payment_fee',
    'service_entitlement_policy',
  ] as const;

  for (const key of scalarKeys) {
    if (key in item) {
      out[key] = item[key];
    }
  }

  if (item.customer && typeof item.customer === 'object') {
    const customer = item.customer as Record<string, unknown>;
    out.customer = {
      id: customer.id,
      customer_reference:
        customer.customer_reference ?? customer.reference ?? customer.id,
    };
  }

  if (item.plan && typeof item.plan === 'object') {
    const plan = item.plan as Record<string, unknown>;
    out.plan = {
      id: plan.id,
      name: plan.name,
    };
  }

  if (isRecord(item.claim)) {
    out.claim = {
      id: item.claim.id,
      claim_number: item.claim.claim_number,
      state: item.claim.state,
      status: item.claim.status,
      due_date: item.claim.due_date,
      final_due_date: item.claim.final_due_date,
      amount: item.claim.amount,
    };
  }

  return Object.keys(out).length > 0 ? out : item;
}

/** Tight projection for analytical list queries (dates, plan name, customer, claim rules/templates). */
function indexListItem(item: unknown): unknown {
  if (!isRecord(item)) return item;

  const out: Record<string, unknown> = {};

  if ('id' in item) {
    out.id = item.id;
  }

  if ('start_date' in item) {
    out.start_date = item.start_date;
  } else if ('created_at' in item) {
    out.created_at = item.created_at;
  }

  if ('ended_at' in item && item.ended_at != null) {
    out.ended_at = item.ended_at;
  }

  const plan = item.plan;
  if (typeof plan === 'string' || typeof plan === 'number') {
    out.plan = plan;
  } else if (plan && typeof plan === 'object' && 'name' in plan) {
    out.plan = (plan as { name: unknown }).name;
  } else if ('name' in item && typeof item.name === 'string') {
    out.name = item.name;
  } else if (typeof item.title === 'string') {
    out.title = item.title;
  } else if (typeof item.bank_account === 'string') {
    out.bank_account = item.bank_account;
    if (typeof item.category === 'string') {
      out.category = item.category;
    }
  }

  if (typeof item.code === 'string') {
    out.code = item.code;
  }

  const customerRef =
    item.customer_reference ??
    (item.customer && typeof item.customer === 'object'
      ? ((item.customer as Record<string, unknown>).customer_reference ??
        (item.customer as Record<string, unknown>).reference ??
        (item.customer as Record<string, unknown>).id)
      : undefined);
  if (customerRef !== undefined) {
    out.customer_reference = customerRef;
  }

  if (typeof item.email === 'string') {
    out.email = item.email;
  }

  return Object.keys(out).length > 0 ? out : summarizeListItem(item);
}

function serializeListPayload(
  status: number,
  meta: Record<string, unknown>,
  items: unknown[],
  returnedCount: number,
  truncatedByMaxBytes: boolean,
  pretty: boolean,
): string {
  const payload = {
    status,
    meta: {
      ...meta,
      itemCount: items.length,
      returnedCount,
      truncatedByMaxBytes,
    },
    body: items.slice(0, returnedCount),
  };

  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

function maxFittingCount(
  items: unknown[],
  status: number,
  meta: Record<string, unknown>,
  maxBytes: number,
  pretty: boolean,
): number {
  const itemCount = items.length;
  let lo = 0;
  let hi = itemCount;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = serializeListPayload(
      status,
      meta,
      items,
      mid,
      mid < itemCount,
      pretty,
    );
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}

type CompactedMode = 'none' | 'summary' | 'index';

export function buildBoundedListPayload(input: {
  status: number;
  meta: Record<string, unknown>;
  items: unknown[];
  maxBytes: number;
}): FormattedResponse {
  const { status, meta, maxBytes } = input;
  const items = input.items.map((item) => redactSensitiveFields(item));

  const attempts: Array<{
    items: unknown[];
    pretty: boolean;
    compactedMode: CompactedMode;
    note?: string;
  }> = [
    { items, pretty: true, compactedMode: 'none' },
    { items, pretty: false, compactedMode: 'none' },
    {
      items: items.map(summarizeListItem),
      pretty: false,
      compactedMode: 'summary',
      note: 'Items summarized to fit responseMaxBytes',
    },
    {
      items: items.map(indexListItem),
      pretty: false,
      compactedMode: 'index',
      note: 'Items reduced to an index (id, dates, plan, customer) to fit responseMaxBytes',
    },
  ];

  let fullByteLength = 0;
  let bestPartial: {
    text: string;
    returnedCount: number;
    compactedMode: CompactedMode;
    note?: string;
  } | null = null;

  for (const attempt of attempts) {
    const attemptMeta = compactMeta(meta, attempt.compactedMode, attempt.note);
    const fullText = serializeListPayload(
      status,
      attemptMeta,
      attempt.items,
      attempt.items.length,
      false,
      attempt.pretty,
    );
    fullByteLength = Buffer.byteLength(fullText, 'utf8');

    if (fullByteLength <= maxBytes) {
      return {
        text: fullText,
        truncated: false,
        byteLength: fullByteLength,
      };
    }

    const returnedCount = maxFittingCount(
      attempt.items,
      status,
      attemptMeta,
      maxBytes,
      attempt.pretty,
    );

    if (returnedCount > (bestPartial?.returnedCount ?? 0)) {
      bestPartial = {
        text: serializeListPayload(
          status,
          attemptMeta,
          attempt.items,
          returnedCount,
          true,
          attempt.pretty,
        ),
        returnedCount,
        compactedMode: attempt.compactedMode,
        note: attempt.note,
      };
    }
  }

  if (bestPartial && bestPartial.returnedCount > 0) {
    return {
      text: bestPartial.text,
      truncated: true,
      byteLength: fullByteLength,
    };
  }

  const text = serializeListPayload(
    status,
    compactMeta(meta, 'index', 'Response too large; returning metadata only'),
    [],
    0,
    true,
    false,
  );

  return {
    text,
    truncated: true,
    byteLength: fullByteLength,
  };
}

function compactMeta(
  meta: Record<string, unknown>,
  compactedMode: CompactedMode,
  note?: string,
): Record<string, unknown> {
  if (compactedMode === 'none') {
    return meta;
  }

  return {
    ...meta,
    compacted: true,
    compactedMode,
    ...(note ? { note } : {}),
  };
}

export function formatApiResponse(
  status: number,
  headers: Headers,
  bodyText: string,
  maxBytes: number,
  meta?: Record<string, unknown>,
): FormattedResponse {
  const byteLength = Buffer.byteLength(bodyText, 'utf8');
  const truncated = byteLength > maxBytes;
  const safeText = redactSecretsInText(bodyText);
  const visibleBody = truncated ? truncateUtf8(safeText, maxBytes) : safeText;

  let parsedBody: unknown = visibleBody;
  try {
    parsedBody = JSON.parse(visibleBody);
  } catch {
    // keep redacted raw text
  }

  const payload = {
    status,
    headers: pickHeaders(headers),
    meta,
    truncated,
    byteLength,
    body: parsedBody,
  };

  return {
    text: JSON.stringify(payload, null, 2),
    truncated,
    byteLength,
  };
}

function pickHeaders(headers: Headers): Record<string, string> {
  const interesting = ['content-type', 'date', 'x-request-id', 'retry-after'];
  const out: Record<string, string> = {};

  for (const name of interesting) {
    const value = headers.get(name);
    if (value) {
      out[name] = value;
    }
  }

  return out;
}

export function isMutatingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
