import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { registerSingleTool } from "./tools/single.js";
import { registerProxyTool } from "./tools/proxy.js";
import { registerBrowserTool } from "./tools/browser.js";
import { registerAutoTool } from "./tools/auto.js";
import { registerResourceHandler } from "./resources.js";
import { registerPrompts } from "./prompts.js";

type RawRequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

/** Remove the `$schema` keyword from a published JSON Schema, at every depth. */
function withoutDialectMarker<T>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map((entry) => withoutDialectMarker(entry)) as unknown as T;
  }
  if (schema !== null && typeof schema === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$schema") continue;
      cleaned[key] = withoutDialectMarker(value);
    }
    return cleaned as T;
  }
  return schema;
}

/**
 * Publish tool schemas without a dialect marker.
 *
 * The SDK converts the tool shapes with a draft-07 target and stamps
 * `"$schema": "http://json-schema.org/draft-07/schema#"` on every published input and output
 * schema. A client whose JSON Schema validator knows only 2020-12 cannot resolve that
 * meta-schema, so it rejects the tool: at load time, or at the first call. These schemas use
 * no dialect-specific keywords, so publish them unmarked and let each client validate them in
 * the dialect it implements.
 */
function publishDialectNeutralToolSchemas(server: McpServer): void {
  const handlers = (server.server as unknown as {
    _requestHandlers: Map<string, RawRequestHandler>;
  })._requestHandlers;
  const listTools = handlers.get("tools/list");
  if (!listTools) {
    throw new Error("tools/list has no handler to wrap: tool registration changed shape");
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = (await listTools(request, extra)) as ListToolsResult;
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        inputSchema: withoutDialectMarker(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: withoutDialectMarker(tool.outputSchema) } : {}),
      })),
    };
  });
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "foura-mcp",
    title: "FourA",
    version: "0.7.2",
    description:
      "Reliable web access for AI agents: smart HTTP, rotating proxies, and full-browser rendering.",
    websiteUrl: "https://foura.ai/mcp",
    icons: [
      {
        src: "https://foura.ai/logo/avatars/4a-transparent-indigo-512.png",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ],
  });

  registerSingleTool(server);
  registerProxyTool(server);
  registerBrowserTool(server);
  // Keep the lower-level tools first in tools/list and register the default tool after them.
  registerAutoTool(server);
  registerResourceHandler(server);
  registerPrompts(server);
  publishDialectNeutralToolSchemas(server);

  return server;
}
