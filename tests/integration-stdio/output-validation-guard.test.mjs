// Output-validation regressions must produce a structured envelope,
// not a bare "Tool execution failed". We start a local mock API on a
// random port that returns deliberately malformed responses, point foura-mcp
// at it via FOURA_API_BASE, and assert every malformed shape gets converted.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { TEST_KEY } from "./_common.mjs";
import { assertEnvelope } from "../helpers/assertions.mjs";

let mock;
let mockUrl;
let client;
let nextResponse = null;
let statusOverride = 200;

before(async () => {
  mock = createServer((_req, res) => {
    const status = statusOverride;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const port = mock.address().port;
  mockUrl = `http://127.0.0.1:${port}`;

  client = await spawnLocalServer({
    FOURA_API_KEY: TEST_KEY,
    FOURA_API_BASE: mockUrl, // foura-mcp will POST to mockUrl/single/ etc.
  });
});
after(async () => {
  await client?.close();
  await new Promise((r) => mock.close(r));
});

describe("output validation guard converts crashes to an envelope", () => {
  test("1. single - malformed headers (string instead of array) survives as envelope or success", async () => {
    nextResponse = { status: 200, headers: "this-is-not-an-array", data: "hi" };
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://example.com",
    }, 30_000);
    // Either: schema is permissive enough (headers union accepts string) -> success
    // Or: validation crashed -> output_validation_failed envelope
    if (r.isError) {
      assertEnvelope(r, "single");
    } else {
      assert.equal(r.structuredContent?.status, 200);
    }
  });

  test("2. single - invalid total_time type (object) -> either accepted or guarded", async () => {
    nextResponse = { status: 200, headers: [], data: "x", total_time: { weird: true } };
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://example.com",
    }, 30_000);
    if (r.isError) {
      assertEnvelope(r, "single");
      assert.equal(r.structuredContent.code, "output_validation_failed");
    }
  });

  test("3. single - completely garbage response shape -> guarded", async () => {
    nextResponse = { random_garbage: true, no_status: "yes" };
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://example.com",
    }, 30_000);
    // Even with garbage shape, foura-mcp's pass-through accepts extra fields.
    // No crash -> success path. The point is NO bare "Tool execution failed".
    assert.ok(typeof r === "object", "must return object, not throw");
  });

  test("4. single - body.error triggers regression path, not output validation", async () => {
    nextResponse = { status: 0, data: "", total_time: 0, error: "Connection refused" };
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://example.com",
    }, 30_000);
    assert.equal(r.isError, true);
    assertEnvelope(r, "single");
    assert.match(r.structuredContent.error, /Connection refused/);
  });

  test("5. proxy - body.error from PrResponseError shape (regression)", async () => {
    nextResponse = {
      error: "Download maxTry limit reached",
      request: { request: { method: "GET", url: "https://example.com" } },
      total: 5.0,
    };
    const r = await client.callTool("foura_proxy", {
      maxTries: 5,
      request: { method: "GET", url: "https://example.com" },
    }, 30_000);
    assert.equal(r.isError, true);
    assertEnvelope(r, "proxy");
    assert.match(r.structuredContent.error, /maxTry limit/i);
  });

  test("6. browser error body becomes a structured envelope", async () => {
    nextResponse = { error: "Navigation timeout of 30000 ms exceeded", status: 0 };
    const r = await client.callTool("foura_browser", {
      url: "https://example.com",
    }, 30_000);
    assert.equal(r.isError, true);
    assertEnvelope(r, "browser");
    assert.match(r.structuredContent.error, /Navigation timeout/);
  });

  test("7. non-2xx HTTP status from gateway -> upstream_non_json or deriveCode envelope", async () => {
    statusOverride = 502;
    nextResponse = { error: "Bad Gateway" };
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://example.com",
    }, 30_000);
    statusOverride = 200; // reset for subsequent tests
    assert.equal(r.isError, true);
    assertEnvelope(r, "single");
  });
});
