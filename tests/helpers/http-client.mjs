// Streamable HTTP client for the deployed mcp.foura.ai endpoint.
// Used by tests/integration-http/*.

import { request } from "undici";

const DEFAULT_URL = process.env.FOURA_MCP_HTTP_URL ?? "https://mcp.foura.ai/mcp";

export class HttpClient {
  constructor({ url = DEFAULT_URL, apiKey } = {}) {
    this.url = url;
    this.apiKey = apiKey ?? process.env.FOURA_API_KEY ?? process.env.DW_TEST_API_KEY;
    if (!this.apiKey) {
      throw new Error("FOURA_API_KEY (or DW_TEST_API_KEY) must be set for HTTP tests");
    }
    this.sessionId = null;
    this.nextId = 1;
  }

  async _send(method, params) {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await request(this.url, { method: "POST", headers, body });
    if (res.statusCode === 401) {
      return { http: res.statusCode, error: { code: -32001, message: "Unauthorized" } };
    }
    const text = await res.body.text();
    const ct = (res.headers["content-type"] ?? "").toString().toLowerCase();
    if (ct.includes("text/event-stream")) {
      // Parse SSE — find first `data: {...}` line that decodes to a JSON-RPC message.
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload && payload !== "[DONE]") {
            try {
              const msg = JSON.parse(payload);
              return { http: res.statusCode, ...msg };
            } catch {}
          }
        }
      }
      return { http: res.statusCode, raw: text };
    }
    try {
      const msg = JSON.parse(text);
      return { http: res.statusCode, ...msg };
    } catch {
      return { http: res.statusCode, raw: text };
    }
  }

  async initialize() {
    const r = await this._send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "foura-mcp-tests", version: "0.0.1" },
    });
    return r;
  }

  async listTools() {
    const r = await this._send("tools/list", {});
    return r.result?.tools ?? [];
  }

  async listPrompts() {
    const r = await this._send("prompts/list", {});
    return r.result?.prompts ?? [];
  }

  async callTool(name, args) {
    const r = await this._send("tools/call", { name, arguments: args });
    return r.result ?? { isError: true, errorObj: r.error };
  }

  async healthz() {
    const url = new URL(this.url);
    url.pathname = "/healthz";
    const res = await request(url.toString());
    const text = await res.body.text();
    try {
      return { http: res.statusCode, ...JSON.parse(text) };
    } catch {
      return { http: res.statusCode, raw: text };
    }
  }
}
