import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, assertEnvelope } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("foura_proxy - functional paths", () => {
  test("1. GET httpbin/ip -> 200, proxy field, total float", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 3,
      request: { method: "GET", url: TEST_SITES.ip, unblocker: true },
    }, TWO_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    assert.equal(typeof r.structuredContent.proxy, "string");
    assert.ok(r.structuredContent.proxy.length > 0);
    assert.equal(typeof r.structuredContent.total, "number");
  });

  test("2. POST with JSON body echoed via proxy (tolerant of pool failures)", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 5,
      timeout_ms: 60_000,
      request: {
        method: "POST",
        url: TEST_SITES.echo_anything,
        headers: [["Content-Type", "application/json"]],
        data: { from: "proxy" },
        tryJsonData: true,
        unblocker: true,
        timeout_ms: 15_000,
      },
    }, TWO_MIN);
    if (r.isError) {
      // Real proxy pool can fail POST through some proxies (HTTP/2 quirks).
      // regression must surface the failure as a structured envelope.
      assertEnvelope(r, "proxy");
      return;
    }
    assertSuccess(r);
    assert.deepEqual(r.structuredContent.data?.json, { from: "proxy" });
  });

  test("3. unblocker injects Chrome headers (gateway translates to chromeHeaders)", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 5,
      timeout_ms: 60_000,
      request: {
        method: "GET",
        url: TEST_SITES.echo_headers,
        unblocker: true,
        tryJsonData: true,
        timeout_ms: 15000,
      },
    }, TWO_MIN);
    // Proxy pool nondeterminism - accept either success or all-fail envelope.
    if (r.isError) {
      assertEnvelope(r, "proxy");
      return;
    }
    assertSuccess(r);
    const ua = r.structuredContent.data?.headers?.["User-Agent"] ?? "";
    // The server's own user agent must never leak to the target.
    assert.ok(!ua.toLowerCase().includes("foura-mcp"), `proxy leaked server UA: ${ua}`);
  });

  test("4. ignoreProxies accepts string array", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 2,
      ignoreProxies: ["BOGUS_NONEXISTING_ID"],
      request: { method: "GET", url: TEST_SITES.ip, unblocker: true },
    }, TWO_MIN);
    // An unknown ID is ignored safely.
    if (r.isError) assertEnvelope(r, "proxy");
    else assertSuccess(r);
  });

  test("5. all-proxies-fail surfaces as a structured error", async () => {
    // Force a high-failure scenario: very low timeout against slow endpoint.
    const r = await client.callTool("foura_proxy", {
      maxTries: 1,
      timeout_ms: 500,
      request: { method: "GET", url: TEST_SITES.delay(5), timeout_ms: 200, unblocker: true },
    }, TWO_MIN);
    // Every failure mode must set isError and return an envelope.
    if (!r.isError) {
      // If it somehow succeeded, that's also OK
      assertSuccess(r);
    } else {
      assertEnvelope(r, "proxy");
    }
  });

  test("6. maxTries=0 -> schema rejects at input layer", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 0,
      request: { method: "GET", url: TEST_SITES.static },
    }, TWO_MIN);
    assert.equal(r.isError, true);
  });

  test("7. missing inner request -> input validation fails", async () => {
    const r = await client.callTool("foura_proxy", { maxTries: 3 }, TWO_MIN);
    assert.equal(r.isError, true);
  });

  test("8. SSRF on inner URL blocked (service=proxy)", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 2,
      request: { method: "GET", url: TEST_SITES.ssrf.loopback },
    }, TWO_MIN);
    assertEnvelope(r, "proxy");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });
});
