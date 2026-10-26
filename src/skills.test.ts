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
  responseMaxBytes: 64_000,
  mutationGate: 'auto',
};

async function listSkills(): Promise<string[]> {
  const catalog = await loadPublishedSkills();
  const server = createServer(baseConfig);
  catalog.attach(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  try {
    const response = await new Promise<JSONRPCMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('skills/list timed out')),
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
          method: 'skills/list',
          params: {},
        }),
      );
    });

    if (!('result' in response) || response.result == null) {
      throw new Error(
        `expected skills/list result, got ${JSON.stringify(response)}`,
      );
    }

    const result = response.result as {
      skills?: Array<{ frontmatter?: { name?: string } }>;
    };
    return (result.skills ?? []).map((entry) => entry.frontmatter?.name ?? '');
  } finally {
    await server.close();
  }
}

describe('published skills', () => {
  test('loads askell-docs and askell-mcp', async () => {
    const names = await listSkills();
    expect(names.sort()).toEqual(['askell-docs', 'askell-mcp']);
  });
});
