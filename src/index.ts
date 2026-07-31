import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.ts';
import { createServer } from './server.ts';

try {
  const config = await loadConfig();

  void serveStdio(() => createServer(config));

  console.error('askell-mcp running on stdio');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`askell-mcp failed to start: ${message}`);
  process.exit(1);
}
