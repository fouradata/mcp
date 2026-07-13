import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../helpers/http-client.mjs";

const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;

let client;
before(async () => {
  client = new HttpClient({ apiKey: TEST_KEY });
  await client.initialize();
});

describe("mcp.foura.ai tools/call - smoke against deployed", () => {
  test("1. foura_single GET example.com", async () => {
    const r = await client.callTool("foura_single", { method: "GET", url: "https://example.com" });
    assert.notEqual(r.isError, true, `got error: ${JSON.stringify(r).slice(0, 300)}`);
    assert.equal(r.structuredContent?.status, 200);
  });

  test("2. foura_proxy small GET", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 3,
      request: { method: "GET", url: "https://httpbin.org/ip", unblocker: true },
    });
    // Allow envelope on proxy pool nondeterminism.
    if (r.isError) {
      assert.equal(r.structuredContent?.service, "proxy");
      return;
    }
    assert.equal(r.structuredContent?.status, 200);
    assert.ok(typeof r.structuredContent?.proxy === "string");
  });

  test("3. foura_browser example.com renders", async () => {
    const r = await client.callTool("foura_browser", { url: "https://example.com", timeout_ms: 60_000 });
    if (r.isError) {
      assert.equal(r.structuredContent?.service, "browser");
      return;
    }
    assert.equal(r.structuredContent?.status, 200);
  });
});
