import { describe, expect, test } from 'bun:test';

import {
  PRODUCTION_API_BASE_URL,
  SANDBOX_API_BASE_URL,
  type AppConfig,
} from './config.ts';
import { buildServerInstructions } from './server.ts';
import { PACKAGE_VERSION } from './version.ts';
import packageJson from '../package.json' with { type: 'json' };

const baseConfig: AppConfig = {
  askellEnv: 'production',
  apiBaseUrl: PRODUCTION_API_BASE_URL,
  secretApiKey: 'secret.key',
  responseMaxBytes: 64_000,
  mutationGate: 'auto',
};

describe('PACKAGE_VERSION', () => {
  test('matches package.json (MCP initialize version)', () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});

describe('buildServerInstructions', () => {
  test('names the sandbox instance without treating it as production', () => {
    const sandbox = buildServerInstructions({
      ...baseConfig,
      askellEnv: 'sandbox',
      apiBaseUrl: SANDBOX_API_BASE_URL,
    });

    expect(sandbox).toContain(`This instance: sandbox (${SANDBOX_API_BASE_URL})`);
    expect(sandbox).toContain(`production: ${PRODUCTION_API_BASE_URL}`);
    expect(sandbox).toContain(
      `sandbox (isolated tenant, separate API keys): ${SANDBOX_API_BASE_URL}`,
    );
    expect(sandbox).toContain('ASKELL_ENV=production|sandbox');
    expect(sandbox).toContain('askell_list_operations');
    expect(sandbox).not.toContain(
      `This instance: production (${PRODUCTION_API_BASE_URL})`,
    );
  });

  test('defaults instance to production', () => {
    const prod = buildServerInstructions(baseConfig);
    expect(prod).toContain(
      `This instance: production (${PRODUCTION_API_BASE_URL})`,
    );
  });

  test('labels a custom API base', () => {
    const custom = buildServerInstructions({
      ...baseConfig,
      askellEnv: 'custom',
      apiBaseUrl: 'http://localhost:8000/api',
    });
    expect(custom).toContain(
      'This instance: custom API base http://localhost:8000/api',
    );
  });
});
