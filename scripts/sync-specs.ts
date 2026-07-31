#!/usr/bin/env bun

const SPECS = [
  {
    version: 'v1',
    url: 'https://askell.is/api/swagger/swagger.json',
    output: new URL('../spec/openapi-v1.json', import.meta.url),
  },
  {
    version: 'v2',
    url: 'https://askell.is/api/swagger/v2/swagger.json',
    output: new URL('../spec/openapi-v2.json', import.meta.url),
  },
] as const;

for (const spec of SPECS) {
  console.error(`Fetching Askell OpenAPI ${spec.version}...`);
  const response = await fetch(spec.url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${spec.url}: HTTP ${response.status}`);
  }

  const json = await response.json();
  await Bun.write(spec.output, JSON.stringify(json, null, 2));
  console.error(`Wrote ${spec.output.pathname}`);
}

console.error('Done.');
