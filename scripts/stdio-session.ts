import type { Subprocess } from 'bun';

export type JsonRpcResponse = {
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
    tools?: { name: string }[];
    resources?: { uri: string; name?: string }[];
    contents?: { uri: string; text?: string; mimeType?: string }[];
    serverInfo?: { name?: string };
    instructions?: string;
  };
  error?: { message?: string; code?: number };
};

export async function readJsonRpcLine(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const newline = buffer.indexOf('\n');
    if (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      reader.releaseLock();
      return JSON.parse(line);
    }
  }

  reader.releaseLock();
  throw new Error(`no JSON-RPC line (buffer=${buffer.slice(0, 200)})`);
}

export class McpSession {
  private nextId = 1;

  constructor(private readonly proc: Subprocess<'pipe', 'pipe', 'pipe'>) {}

  async request(
    method: string,
    params: unknown = {},
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    this.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
    );
    return (await readJsonRpcLine(this.proc.stdout)) as JsonRpcResponse;
  }

  notify(method: string, params: unknown = {}): void {
    this.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  }

  async close(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
  }
}

export async function callTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  text: string;
  isError: boolean;
  parsed?: unknown;
  structuredContent?: unknown;
}> {
  const response = await session.request('tools/call', {
    name,
    arguments: args,
  });

  if (response.error) {
    throw new Error(`${name}: ${response.error.message ?? 'RPC error'}`);
  }

  const text = response.result?.content?.[0]?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  return {
    text,
    isError: response.result?.isError ?? false,
    parsed,
    structuredContent: response.result?.structuredContent,
  };
}
