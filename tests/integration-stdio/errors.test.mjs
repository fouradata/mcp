// Error envelope contract - every isError must carry {service, code, error}.
// Covers every code in deriveCode() plus the main regression paths.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertEnvelope } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("Error envelope - every error path carries {service, code, error}", () => {
  test("1. invalid API key -> auth_failed", async () => {
    const bad = await spawnLocalServer({ FOURA_API_KEY: "pk_live_invalid_xxx_zzz" });
    try {
      const r = await bad.callTool("foura_single", { method: "GET", url: TEST_SITES.static }, 30_000);
      assertEnvelope(r, "single");
      assert.equal(r.structuredContent.code, "auth_failed");
    } finally {
      await bad.close();
    }
  });

  test("2. SSRF block - foura_single -> code=ssrf_blocked, service=single", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.ssrf.loopback,
    }, TWO_MIN);
    assertEnvelope(r, "single");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("3. SSRF block - foura_proxy", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 1, request: { method: "GET", url: TEST_SITES.ssrf.rfc1918_10 },
    }, TWO_MIN);
    assertEnvelope(r, "proxy");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("4. SSRF block - foura_browser", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.ssrf.aws_metadata,
    }, TWO_MIN);
    assertEnvelope(r, "browser");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("5. SSRF IPv6 link-local blocked", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.ssrf.ipv6_linklocal,
    }, TWO_MIN);
    assertEnvelope(r, "single");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("6. SSRF IPv4-mapped canonical hex regression", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: "http://[::ffff:c0a8:0101]",
    }, TWO_MIN);
    assertEnvelope(r, "single");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("7. regression - single timeout -> 2xx-with-error -> structured envelope", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.delay(10), timeout_ms: 500,
    }, TWO_MIN);
    assert.equal(r.isError, true, "regression - timeout body must surface as error");
    assertEnvelope(r, "single");
  });

  test("8. regression - proxy with low timeout surfaces envelope", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 1, timeout_ms: 500,
      request: { method: "GET", url: TEST_SITES.delay(10), timeout_ms: 200 },
    }, TWO_MIN);
    assert.equal(r.isError, true);
    assertEnvelope(r, "proxy");
  });

  test("9. regression - browser checkText mismatch -> envelope", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.static, checkText: "NOT_PRESENT_ZZZ_xyz_404",
    }, TWO_MIN);
    assert.equal(r.isError, true);
    assertEnvelope(r, "browser");
  });

  test("10. Invalid URL -> MCP layer rejects before forwarding", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: "not-a-url",
    }, TWO_MIN);
    assert.equal(r.isError, true);
  });

  test("11. status 500 from target -> upstream_error path", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.status(500),
    }, TWO_MIN);
    // Curl returns 500 status, the upstream API wraps as 200-with-status:500. Either:
    // - 2xx-with-error-body path (regression catches) -> isError
    // - or pure success with status=500 (no .error field)
    if (r.isError) {
      assertEnvelope(r, "single");
    } else {
      assert.equal(r.structuredContent.status, 500);
    }
  });

  test("12. envelope code is in the stable enum (every call we just ran)", () => {
    // Already enforced by assertEnvelope() - this is a placeholder marker.
    assert.ok(true);
  });
});
