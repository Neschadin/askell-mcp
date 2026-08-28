import * as z from 'zod';

export const MUTATION_GATES = ['auto', 'elicit', 'off'] as const;
export type MutationGate = (typeof MUTATION_GATES)[number];

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .describe('Askell API base URL (default production host)');

const mutationGateAliases = z
  .enum(['true', 'false', 'on', 'yes', 'no', '1', '0'])
  .transform((value): MutationGate => {
    return value === 'true' || value === 'on' || value === 'yes' || value === '1'
      ? 'elicit'
      : 'off';
  });

export const MutationGateSchema = z
  .union([
    z.enum(MUTATION_GATES),
    z.boolean().transform((value): MutationGate => (value ? 'elicit' : 'off')),
    mutationGateAliases,
  ])
  .default('auto')
  .describe(
    'Mutation confirmation: auto (elicit if client declared it), elicit (require form), off (never)',
  );

export const ConfigSchema = z.object({
  apiBaseUrl: httpUrl.default('https://askell.is/api'),
  secretApiKey: z.string().min(1).describe('Secret (private) API key'),
  publicApiKey: z
    .string()
    .min(1)
    .optional()
    .describe('Public API key for temporary payment method endpoints'),
  responseMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(64_000)
    .describe('Max response body size returned to the model'),
  mutationGate: MutationGateSchema,
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

function loadConfigFromEnv(): unknown {
  const env = Bun.env;
  const secretApiKey = env.ASKELL_PRIVATE_API_KEY ?? env.ASKELL_SECRET_API_KEY;

  if (!secretApiKey) {
    return undefined;
  }

  const apiBaseUrl = env.ASKELL_API_URL ?? env.ASKELL_API_BASE_URL;
  const responseMaxBytes = env.ASKELL_RESPONSE_MAX_BYTES;
  const mutationGateRaw =
    env.ASKELL_MUTATION_GATE ?? env.ASKELL_REQUIRE_MUTATION_APPROVAL;
  const mutationGate = mutationGateRaw?.trim().toLowerCase() || undefined;

  return {
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    secretApiKey,
    ...(env.ASKELL_PUBLIC_API_KEY
      ? { publicApiKey: env.ASKELL_PUBLIC_API_KEY }
      : {}),
    ...(responseMaxBytes ? { responseMaxBytes } : {}),
    ...(mutationGate !== undefined ? { mutationGate } : {}),
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
