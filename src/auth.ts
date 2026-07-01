import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Shared FourA auth.
 *
 * The API key authenticates the CALLER, not the endpoint - one key opens
 * /single/, /proxy/, and /browser/. So this lives in one place and is
 * imported by every tool. (Schemas, paths, and per-endpoint behavior remain
 * fully duplicated across tool files - see
 * .)
 *
 * Dual-mode:
 *   - stdio: the user sets FOURA_API_KEY in env (e.g. via claude_desktop_config).
 *   - HTTP: each incoming /mcp request supplies its own key via
 *     Authorization: Bearer pk_live_..., which the transport scopes into
 *     AsyncLocalStorage before invoking the tool handler.
 */
const apiKeyContext = new AsyncLocalStorage<string>();

export function withApiKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return apiKeyContext.run(key, fn);
}

export function getApiKey(): string {
  const fromContext = apiKeyContext.getStore();
  if (fromContext) return fromContext;
  const fromEnv = process.env.FOURA_API_KEY;
  if (fromEnv) return fromEnv;
  throw new Error(
    "FOURA_API_KEY not provided. In stdio mode set the FOURA_API_KEY env var. " +
      "In HTTP mode send Authorization: Bearer pk_live_... Get a key at " +
      "https://foura.ai/dashboard#api-keys",
  );
}
