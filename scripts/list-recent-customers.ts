#!/usr/bin/env bun

import { AskellClient } from '../src/client/askell-client.ts';
import { loadConfig } from '../src/config.ts';

const since = new Date('2026-04-10T00:00:00.000Z');
const until = new Date('2026-07-11T00:00:00.000Z');

function inRange(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return date >= since && date < until;
}

async function fetchRecentSubscriptionCustomerRefs(
  client: AskellClient,
): Promise<Set<string>> {
  const refs = new Set<string>();
  let nextUrl: string | null =
    'https://askell.is/api/subscriptions/?page_size=100&ordering=-start_date&type=light';
  const config = await loadConfig();
  const headers = {
    Authorization: `Api-Key ${config.secretApiKey}`,
    Accept: 'application/json',
  };

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers });
    if (!response.ok) {
      throw new Error(`subscriptions list failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as
      | Array<{ customer?: { customer_reference?: string }; reference?: string; start_date?: string }>
      | {
          results?: Array<{
            customer?: { customer_reference?: string };
            reference?: string;
            start_date?: string;
          }>;
          next?: string | null;
        };

    const results = Array.isArray(data) ? data : (data.results ?? []);
    let stop = false;

    for (const sub of results) {
      if (!sub.start_date) continue;
      if (new Date(sub.start_date) < since) {
        stop = true;
        break;
      }
      if (inRange(sub.start_date)) {
        const ref = sub.customer?.customer_reference ?? sub.reference;
        if (ref) refs.add(ref);
      }
    }

    if (stop) break;
    nextUrl = Array.isArray(data) ? null : (data.next ?? null);
  }

  return refs;
}

async function earliestSubscriptionStart(
  client: AskellClient,
  customerReference: string,
): Promise<string | undefined> {
  const response = await client.request({
    method: 'GET',
    path: `/customers/${encodeURIComponent(customerReference)}/subscriptions/`,
  });

  const parsed = JSON.parse(response.text) as { body?: unknown };
  const body = parsed.body;
  const subs = Array.isArray(body)
    ? body
    : body &&
        typeof body === 'object' &&
        'results' in body &&
        Array.isArray((body as { results: unknown[] }).results)
      ? (body as { results: Array<{ start_date?: string }> }).results
      : [];

  let earliest: string | undefined;
  for (const sub of subs) {
    if (!sub.start_date) continue;
    if (!earliest || new Date(sub.start_date) < new Date(earliest)) {
      earliest = sub.start_date;
    }
  }

  return earliest;
}

const config = await loadConfig();
const client = new AskellClient(config);
const candidateRefs = await fetchRecentSubscriptionCustomerRefs(client);

const customers: Array<{
  customer_reference: string;
  name: string;
  email: string | null;
  first_subscription_at: string;
  plan: string | number | undefined;
}> = [];

for (const ref of [...candidateRefs].sort()) {
  const firstAt = await earliestSubscriptionStart(client, ref);
  if (!firstAt || !inRange(firstAt)) {
    continue;
  }

  const customerRes = await client.request({
    method: 'GET',
    path: `/customers/${encodeURIComponent(ref)}/`,
  });
  const customer = JSON.parse(customerRes.text).body as {
    customer_reference: string;
    first_name?: string;
    last_name?: string;
    email?: string | null;
  };

  const subsRes = await client.request({
    method: 'GET',
    path: `/customers/${encodeURIComponent(ref)}/subscriptions/`,
  });
  const subsBody = JSON.parse(subsRes.text).body;
  const subs = Array.isArray(subsBody)
    ? subsBody
    : subsBody &&
        typeof subsBody === 'object' &&
        'results' in subsBody &&
        Array.isArray((subsBody as { results: unknown[] }).results)
      ? (subsBody as { results: Array<{ start_date?: string; plan?: { name?: string } | number }> }).results
      : [];
  const firstSub = subs.find((sub) => sub.start_date === firstAt) ?? subs[0];
  const plan =
    firstSub &&
    typeof firstSub === 'object' &&
    'plan' in firstSub &&
    firstSub.plan &&
    typeof firstSub.plan === 'object' &&
    'name' in firstSub.plan
      ? (firstSub.plan as { name?: string }).name
      : firstSub && typeof firstSub === 'object' && 'plan' in firstSub
        ? (firstSub.plan as string | number | undefined)
        : undefined;

  customers.push({
    customer_reference: customer.customer_reference,
    name:
      [customer.first_name, customer.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      customer.last_name ||
      customer.first_name ||
      '',
    email: customer.email ?? null,
    first_subscription_at: firstAt,
    plan,
  });
}

customers.sort(
  (a, b) =>
    new Date(b.first_subscription_at).getTime() -
    new Date(a.first_subscription_at).getTime(),
);

console.log(
  JSON.stringify(
    {
      period: '2026-04-10 — 2026-07-10 (last 3 months)',
      note:
        'Askell Customer API has no created_at; list uses first subscription start_date as registration proxy',
      count: customers.length,
      customers,
    },
    null,
    2,
  ),
);
