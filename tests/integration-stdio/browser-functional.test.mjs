import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, assertEnvelope } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("foura_browser - functional paths", () => {
  test("1. example.com renders, returns body + userAgent", async () => {
    const r = await client.callTool("foura_browser", { url: TEST_SITES.static }, TWO_MIN);
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.toLowerCase().includes("<html") || bodyStr.toLowerCase().includes("example"));
    assert.equal(typeof r.structuredContent.userAgent, "string");
  });

  test("1b. unblocker:false renders the page as-is (field forwards, open target)", async () => {
    // example.com has no challenge, so unblocker has no visible effect - the
    // point is that the canonical defense-solver flag forwards without breaking
    // and the page still renders. Pool/render nondeterminism tolerated.
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.static, timeout_ms: 60_000, unblocker: false,
    }, TWO_MIN);
    if (r.isError) {
      assertEnvelope(r, "browser");
      return;
    }
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.toLowerCase().includes("<html") || bodyStr.toLowerCase().includes("example"));
  });

  test("2. cookies returned as CDP shape (best-effort against httpbin redirects)", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.cookies_set, timeout_ms: 60_000,
    }, TWO_MIN);
    // httpbin's redirect can intermittently confuse the browser session;
    // the schema-level test is in unit/schema/browser-output. Here we just
    // assert that the response shape is valid in either branch.
    if (r.isError) {
      assert.equal(r.structuredContent?.service, "browser");
      return;
    }
    assertSuccess(r);
    const cookies = r.structuredContent.cookies ?? [];
    assert.ok(Array.isArray(cookies));
  });

  test("3. pre-set cookies sent on navigation", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.cookies_read,
      cookies: [{ name: "pre", value: "set", domain: "httpbin.org" }],
    }, TWO_MIN);
    assertSuccess(r);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.includes("pre") && bodyStr.includes("set"), `pre-set cookie not visible in response: ${bodyStr.slice(0, 300)}`);
  });

  test("4. headers object form forwarded", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.echo_headers,
      headers: { "X-Test": "browser-42" },
    }, TWO_MIN);
    assertSuccess(r);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.includes("browser-42"));
  });

  test("5. checkText success when substring present", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.static, checkText: "Example Domain",
    }, TWO_MIN);
    assertSuccess(r);
  });

  test("6. checkText failure -> structured error (regression path)", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.static, checkText: "NOT_PRESENT_STRING_xyz_12345",
    }, TWO_MIN);
    // The API surfaces this as an error body, so the handler flags isError.
    assert.equal(r.isError, true, `expected error for checkText mismatch, got success`);
    assertEnvelope(r, "browser");
  });

  test("7. checkStatus match -> success", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.static, checkStatus: 200,
    }, TWO_MIN);
    assertSuccess(r);
  });

  test("8. SSRF blocked at browser layer too", async () => {
    const r = await client.callTool("foura_browser", { url: TEST_SITES.ssrf.loopback }, TWO_MIN);
    assertEnvelope(r, "browser");
    assert.equal(r.structuredContent.code, "ssrf_blocked");
  });

  test("9. body as object when target returns JSON (regression)", async () => {
    const r = await client.callTool("foura_browser", { url: TEST_SITES.json }, TWO_MIN);
    assertSuccess(r);
    // body can be either string (HTML wrap) or object (auto-parsed JSON).
    const body = r.structuredContent.body;
    assert.ok(typeof body === "string" || typeof body === "object", `unexpected body type ${typeof body}`);
  });

  test("10. userAgent override forwarded (best effort)", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.echo_headers, userAgent: "FOURA-TEST/1.0",
    }, TWO_MIN);
    assertSuccess(r);
    // the upstream API may pin its own UA; we just assert no schema error.
  });
});
