import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Read the API key from the environment in stdio mode or from the current HTTP request scope.
 */
const apiKeyContext = new AsyncLocalStorage<string>();

export function withApiKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return apiKeyContext.run(key, fn);
}

export function getApiKey(): string {
  // An HTTP request scope, including an empty one, takes precedence over stdio configuration.
  const fromContext = apiKeyContext.getStore();
  if (fromContext !== undefined) {
    if (fromContext) return fromContext;
    throw new Error(
      "No API key on this MCP request. Send 'Authorization: Bearer pk_live_...'. " +
        "Get a key at https://foura.ai/dashboard#api-keys",
    );
  }
  const fromEnv = process.env.FOURA_API_KEY;
  if (fromEnv) return fromEnv;
  throw new Error(
    "FOURA_API_KEY not provided. In stdio mode set the FOURA_API_KEY env var. " +
      "In HTTP mode send Authorization: Bearer pk_live_... Get a key at " +
      "https://foura.ai/dashboard#api-keys",
  );
}
