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
    title: "FourA",
    version: "0.5.0",
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

  return server;
}
