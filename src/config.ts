import * as z from 'zod';

export const PRODUCTION_API_BASE_URL = 'https://askell.is/api';
export const SANDBOX_API_BASE_URL = 'https://sandbox.askell.is/api';

export const ASKELL_ENVS = ['production', 'sandbox'] as const;
export type AskellOfficialEnv = (typeof ASKELL_ENVS)[number];
export type AskellEnv = AskellOfficialEnv | 'custom';

export const ASKELL_API_BASE_URLS = {
  production: PRODUCTION_API_BASE_URL,
  sandbox: SANDBOX_API_BASE_URL,
} as const satisfies Record<AskellOfficialEnv, string>;

export const MUTATION_GATES = ['auto', 'elicit', 'off'] as const;
export type MutationGate = (typeof MUTATION_GATES)[number];

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .describe('Custom Askell API base URL (local/fork override)');

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

export const AskellEnvSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === 'prod' ? 'production' : value))
  .pipe(z.enum(ASKELL_ENVS));

export function classifyAskellHost(apiBaseUrl: string): AskellEnv {
  const normalized = normalizeBaseUrl(apiBaseUrl);
  if (normalized === PRODUCTION_API_BASE_URL) {
    return 'production';
  }
  if (normalized === SANDBOX_API_BASE_URL) {
    return 'sandbox';
  }
  return 'custom';
}

export function resolveAskellTarget(input: {
  askellEnv?: AskellOfficialEnv;
  apiBaseUrl?: string;
}): { askellEnv: AskellEnv; apiBaseUrl: string } {
  if (input.apiBaseUrl) {
    const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
    const classified = classifyAskellHost(apiBaseUrl);

    if (input.askellEnv !== undefined) {
      if (classified === 'custom') {
        throw new Error(
          `ASKELL_ENV=${input.askellEnv} selects an official Askell host; omit ASKELL_ENV when ASKELL_API_BASE_URL is custom (${apiBaseUrl})`,
        );
      }
      if (classified !== input.askellEnv) {
        throw new Error(
          `ASKELL_ENV=${input.askellEnv} does not match ASKELL_API_BASE_URL (${apiBaseUrl}). Omit ASKELL_API_BASE_URL and let ASKELL_ENV pick the host, or omit ASKELL_ENV.`,
        );
      }
    }

    return { askellEnv: classified, apiBaseUrl };
  }

  const askellEnv = input.askellEnv ?? 'production';
  return { askellEnv, apiBaseUrl: ASKELL_API_BASE_URLS[askellEnv] };
}

const ConfigInputSchema = z.object({
  askellEnv: AskellEnvSchema.optional(),
  apiBaseUrl: httpUrl.optional(),
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

export const ConfigSchema = ConfigInputSchema.superRefine((value, ctx) => {
  try {
    resolveAskellTarget({
      askellEnv: value.askellEnv,
      apiBaseUrl: value.apiBaseUrl,
    });
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}).transform((value) => {
  const target = resolveAskellTarget({
    askellEnv: value.askellEnv,
    apiBaseUrl: value.apiBaseUrl,
  });
  return {
    ...value,
    askellEnv: target.askellEnv,
    apiBaseUrl: target.apiBaseUrl,
  };
});

export type AppConfig = z.output<typeof ConfigSchema>;

const CONFIG_HELP = `Askell MCP credentials missing.

Set ASKELL_PRIVATE_API_KEY (or ASKELL_SECRET_API_KEY), optionally ASKELL_PUBLIC_API_KEY.
Set ASKELL_ENV=production|sandbox (default production) — the server picks the host.
Keys are per host. ASKELL_API_BASE_URL is only for a custom/local API.

  Local dev — create .env in the project root (Bun loads it automatically):
    ASKELL_ENV=sandbox
    ASKELL_PRIVATE_API_KEY=...
    ASKELL_PUBLIC_API_KEY=...

  Published package (requires Bun) — Cursor / Claude mcp.json (two entries if you use sandbox):
    {
      "mcpServers": {
        "askell-prod": {
          "command": "bunx",
          "args": ["-y", "askell-mcp@latest"],
          "env": {
            "ASKELL_ENV": "production",
            "ASKELL_PRIVATE_API_KEY": "...",
            "ASKELL_PUBLIC_API_KEY": "..."
          }
        },
        "askell-sandbox": {
          "command": "bunx",
          "args": ["-y", "askell-mcp@latest"],
          "env": {
            "ASKELL_ENV": "sandbox",
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

  const askellEnv = env.ASKELL_ENV?.trim() || undefined;
  const apiBaseUrl = env.ASKELL_API_BASE_URL;
  const responseMaxBytes = env.ASKELL_RESPONSE_MAX_BYTES;
  const mutationGateRaw =
    env.ASKELL_MUTATION_GATE ?? env.ASKELL_REQUIRE_MUTATION_APPROVAL;
  const mutationGate = mutationGateRaw?.trim().toLowerCase() || undefined;

  return {
    ...(askellEnv ? { askellEnv } : {}),
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
