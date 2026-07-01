import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSingleTool } from "./tools/single.js";
import { registerProxyTool } from "./tools/proxy.js";
import { registerBrowserTool } from "./tools/browser.js";
import { registerAutoTool } from "./tools/auto.js";
import { registerResourceHandler } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "foura-mcp",
    version: "0.3.2",
  });

  registerSingleTool(server);
  registerProxyTool(server);
  registerBrowserTool(server);
  // foura_auto is the smart default (URL in → content out); registered after the
  // three primitives it orchestrates so the primitives keep their tools/list order.
  registerAutoTool(server);
  registerResourceHandler(server);
  registerPrompts(server);

  return server;
}
