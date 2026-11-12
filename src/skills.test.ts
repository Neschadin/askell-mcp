import { describe, expect, test } from 'bun:test';
import {
  InMemoryTransport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';

import { PRODUCTION_API_BASE_URL, type AppConfig } from './config.ts';
import { loadPublishedSkills } from './skills.ts';
import { createServer } from './server.ts';

const baseConfig: AppConfig = {
  askellEnv: 'production',
  apiBaseUrl: PRODUCTION_API_BASE_URL,
  secretApiKey: 'secret.key',
  responseMaxBytes: 131_072,
  mutationGate: 'auto',
};

async function rpcRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const catalog = await loadPublishedSkills();
  const server = createServer(baseConfig);
  catalog.attach(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  try {
    const response = await new Promise<JSONRPCMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out`)),
        2000,
      );
      clientTransport.onmessage = (message) => {
        if (
          message &&
          typeof message === 'object' &&
          'id' in message &&
          message.id === 1
        ) {
          clearTimeout(timer);
          resolve(message);
        }
      };
      void clientTransport.start().then(() =>
        clientTransport.send({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
      );
    });

    if (!('result' in response) || response.result == null) {
      throw new Error(
        `expected ${method} result, got ${JSON.stringify(response)}`,
      );
    }

    return response.result;
  } finally {
    await server.close();
  }
}

describe('published skills', () => {
  test('loads embedded askell-docs and askell-mcp without filesystem dependency', async () => {
    const result = (await rpcRequest('skills/list', {})) as {
      skills?: Array<{ frontmatter?: { name?: string }; uri?: string }>;
    };
    const names = (result.skills ?? []).map(
      (entry) => entry.frontmatter?.name ?? '',
    );
    expect(names.sort()).toEqual(['askell-docs', 'askell-mcp']);
  });

  test('serves embedded skill markdown over resources/read with latest spec traps', async () => {
    const read = (await rpcRequest('resources/read', {
      uri: 'skill://askell-docs/SKILL.md',
    })) as { contents?: Array<{ text?: string }> };
    const markdown = read.contents?.[0]?.text ?? '';

    expect(markdown).toContain('GET /v2/claim-rules/');
    expect(markdown).toContain('cancel-claim/');
    expect(markdown).toContain('service_entitlement_policy');
    expect(markdown).toContain('POST /payments/{uuid}/cancel/');
  });
});
