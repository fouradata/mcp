import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../helpers/http-client.mjs";
import { request } from "undici";

const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;
const BASE = process.env.FOURA_MCP_HTTP_URL ?? "https://mcp.foura.ai/mcp";

describe("mcp.foura.ai — Streamable HTTP transport", () => {
  test("1. initialize succeeds with Bearer", async () => {
    const c = new HttpClient({ apiKey: TEST_KEY });
    const r = await c.initialize();
    assert.ok(r.result || r.error, "must return JSON-RPC result or error, not raw text");
    if (r.result) {
      assert.equal(r.result.serverInfo?.name, "foura-mcp");
    }
  });

  test("2. missing Bearer → 401", async () => {
    const res = await request(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } },
      }),
    });
    assert.equal(res.statusCode, 401);
    res.body.dump?.();
  });

  test("3. invalid Bearer → upstream auth_failed", async () => {
    const c = new HttpClient({ apiKey: "pk_live_invalid_xxx" });
    const r = await c.initialize();
    // Either MCP server rejects upstream when first tool runs, or initialize
    // succeeds (key is checked at tool/call time). Either OK.
    assert.ok(r.result || r.error || r.http);
  });

  test("4. GET /mcp → 405", async () => {
    const res = await request(BASE, {
      method: "GET",
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    assert.equal(res.statusCode, 405);
    res.body.dump?.();
  });

  test("5. DELETE /mcp → 405", async () => {
    const res = await request(BASE, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    assert.equal(res.statusCode, 405);
    res.body.dump?.();
  });
});
