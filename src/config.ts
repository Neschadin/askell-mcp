import * as z from 'zod';

export const ConfigSchema = z.object({
  apiBaseUrl: z
    .httpUrl()
    .default('https://askell.is/api')
    .describe('Askell API base URL (default production host)'),
  secretApiKey: z.string().min(1).describe('Secret (private) API key'),
  publicApiKey: z
    .string()
    .optional()
    .describe('Public API key for temporary payment method endpoints'),
  responseMaxBytes: z
    .int()
    .positive()
    .default(64_000)
    .describe('Max response body size returned to the model'),
  requireMutationApproval: z
    .boolean()
    .default(true)
    .describe('Require operator confirmation before mutating requests'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

const CONFIG_HELP = `Askell MCP credentials missing.

Set ASKELL_PRIVATE_API_KEY (or ASKELL_SECRET_API_KEY), optionally ASKELL_PUBLIC_API_KEY and ASKELL_API_URL:

  Local dev — create .env in the project root (Bun loads it automatically):
    ASKELL_PRIVATE_API_KEY=...
    ASKELL_PUBLIC_API_KEY=...

  Published package (requires Bun) — Cursor / Claude mcp.json:
    {
      "mcpServers": {
        "askell": {
          "command": "bunx",
          "args": ["-y", "askell-mcp"],
          "env": {
            "ASKELL_PRIVATE_API_KEY": "...",
            "ASKELL_PUBLIC_API_KEY": "..."
          }
        }
      }
    }`;

function parseEnvFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function loadConfigFromEnv(): unknown {
  const env = Bun.env;
  const secretApiKey = env.ASKELL_PRIVATE_API_KEY ?? env.ASKELL_SECRET_API_KEY;

  if (!secretApiKey) {
    return undefined;
  }

  const apiBaseUrl = env.ASKELL_API_URL ?? env.ASKELL_API_BASE_URL;
  const responseMaxBytes = env.ASKELL_RESPONSE_MAX_BYTES;
  const requireMutationApproval = env.ASKELL_REQUIRE_MUTATION_APPROVAL;

  return {
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    secretApiKey,
    ...(env.ASKELL_PUBLIC_API_KEY
      ? { publicApiKey: env.ASKELL_PUBLIC_API_KEY }
      : {}),
    ...(responseMaxBytes ? { responseMaxBytes: Number(responseMaxBytes) } : {}),
    ...(requireMutationApproval !== undefined
      ? {
          requireMutationApproval: parseEnvFlag(requireMutationApproval, true),
        }
      : {}),
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const fromEnv = loadConfigFromEnv();
  if (!fromEnv) {
    throw new Error(CONFIG_HELP);
  }

  const parsed = ConfigSchema.safeParse(fromEnv);
  if (!parsed.success) {
    throw new Error(
      `Invalid config from environment: ${z.prettifyError(parsed.error)}`,
    );
  }

  return parsed.data;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
