import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.ts';
import { loadPublishedSkills } from './skills.ts';
import { createServer } from './server.ts';

try {
  const [config, skillCatalog] = await Promise.all([
    loadConfig(),
    loadPublishedSkills(),
  ]);

  serveStdio(
    () => {
      const server = createServer(config);
      skillCatalog.attach(server);
      return server;
    },
    {
      onerror: (error) => {
        console.error(`[askell-mcp] stdio error: ${error.message}`);
      },
    },
  );

  console.error(
    `askell-mcp running on stdio (${config.askellEnv} ${config.apiBaseUrl})`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`askell-mcp failed to start: ${message}`);
  process.exit(1);
}
