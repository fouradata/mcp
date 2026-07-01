import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, assertEnvelope } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const THREE_MIN = 180_000;

describe("foura_auto — functional paths", () => {
  test("1. GET example.com (direct) → 200, body present, meta + session", async () => {
    const r = await client.callTool("foura_auto", {
      url: TEST_SITES.static,
      // direct path keeps this cheap + fast for a baseline target
      forceProxy: false,
    }, THREE_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    assert.ok(String(r.structuredContent.data).includes("Example Domain"));
    // meta is always returned (the ladder trace)
    assert.ok(r.structuredContent.meta && typeof r.structuredContent.meta === "object", "meta must be present");
    // returnSession defaults true → session triple present
    assert.ok(r.structuredContent.session && typeof r.structuredContent.session === "object", "session must be present by default");
  });

  test("2. returnSession:false → no session in response", async () => {
    const r = await client.callTool("foura_auto", {
      url: TEST_SITES.static,
      forceProxy: false,
      returnSession: false,
    }, THREE_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    assert.equal(r.structuredContent.session, undefined, "session must be omitted when returnSession:false");
  });

  test("3. validate.data.accept passes on matching content", async () => {
    const r = await client.callTool("foura_auto", {
      url: TEST_SITES.static,
      forceProxy: false,
      validate: { data: { accept: ["Example Domain"] } },
    }, THREE_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
  });

  test("4. SSRF target → ssrf_blocked envelope, service auto", async () => {
    const r = await client.callTool("foura_auto", { url: TEST_SITES.ssrf.loopback }, THREE_MIN);
    assertEnvelope(r, "auto");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("5. SSRF AWS metadata → blocked", async () => {
    const r = await client.callTool("foura_auto", { url: TEST_SITES.ssrf.aws_metadata }, THREE_MIN);
    assertEnvelope(r, "auto");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("6. meta carries rung + credits on success", async () => {
    const r = await client.callTool("foura_auto", {
      url: TEST_SITES.static,
      forceProxy: false,
    }, THREE_MIN);
    assertSuccess(r);
    const meta = r.structuredContent.meta ?? {};
    assert.ok("rung" in meta, "meta.rung expected");
    assert.equal(typeof meta.credits, "number", "meta.credits should be a number");
  });

  test("7. followRedirects multi-hop → lands on final 200, not a 30x", async () => {
    const r = await client.callTool("foura_auto", {
      url: TEST_SITES.redirect_3, forceProxy: false, followRedirects: 5, returnSession: false,
    }, THREE_MIN);
    assertSuccess(r);
    // Redirect chain resolved to the final response, not returned as-is.
    assert.equal(r.structuredContent.status, 200, "followRedirects should land on the final 200");
    // On the direct/proxy rungs auto surfaces the single-shaped header array chain.
    if (Array.isArray(r.structuredContent.headers)) {
      assert.ok(r.structuredContent.headers.length >= 2, "expected multiple hops in the header chain");
    }
  });
});
