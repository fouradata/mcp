import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, assertEnvelope } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("foura_single — functional paths", () => {
  test("1. GET example.com → 200, body present", async () => {
    const r = await client.callTool("foura_single", { method: "GET", url: TEST_SITES.static }, TWO_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    assert.ok(String(r.structuredContent.data).includes("Example Domain"));
  });

  test("2. GET httpbin/json with tryJsonData=true → data is object", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.json, tryJsonData: true, unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    assert.equal(typeof r.structuredContent.data, "object");
  });

  test("3. POST httpbin/anything with body echoed back", async () => {
    const r = await client.callTool("foura_single", {
      method: "POST", url: TEST_SITES.echo_anything,
      headers: [["Content-Type", "application/json"]],
      data: { hello: "world" },
      tryJsonData: true,
      unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    const echoed = r.structuredContent.data?.json;
    assert.deepEqual(echoed, { hello: "world" });
  });

  test("4. headers tuple roundtrip", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.echo_headers,
      headers: [["X-Test", "42"]],
      tryJsonData: true,
      unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    const echoed = r.structuredContent.data?.headers ?? {};
    assert.equal(echoed["X-Test"], "42");
  });

  test("5. followRedirects multi-hop", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.redirect_3, followRedirects: 5,
      unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    assert.ok(Array.isArray(r.structuredContent.headers));
    assert.ok(r.structuredContent.headers.length >= 2, "expected header array with multiple hops");
  });

  test("6. status 418 → upstream_client_error envelope", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.status(418), unblocker: true,
    }, TWO_MIN);
    // 418 from target may be wrapped as success (curl returned 418) — check both paths
    if (r.isError) {
      assertEnvelope(r, "single");
    } else {
      assert.equal(r.structuredContent.status, 418);
    }
  });

  test("7. timeout fast → regression → 2xx-with-error → envelope", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.delay(5), timeout_ms: 1000,
    }, TWO_MIN);
    // Either: api gateway returned non-2xx (handled), or upstream 200 with error body (regression path).
    assert.equal(r.isError, true, `expected error, got: ${JSON.stringify(r).slice(0, 200)}`);
    assertEnvelope(r, "single");
  });

  test("8. PROPFIND verb (regression — z.string()) accepted", async () => {
    // Server may reject or accept depending on target; here we just verify
    // foura-mcp doesn't pre-reject at the schema layer.
    const r = await client.callTool("foura_single", {
      method: "PROPFIND", url: TEST_SITES.static,
    }, TWO_MIN);
    // Either success (200) or upstream rejected — but NOT a schema-level rejection.
    if (r.isError) assertEnvelope(r, "single");
    else assertSuccess(r);
  });

  test("9. invalid url → schema parse error path", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: "not-a-url",
    }, TWO_MIN);
    assert.equal(r.isError, true);
  });

  test("10. validate.status.accept happy path", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.static,
      validate: { status: { accept: [200] } },
    }, TWO_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
  });
});
