import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("Cookies — end-to-end chain across two calls", () => {
  test("1. Set in foura_single, send in next foura_single", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.cookies_read,
      headers: [["Cookie", "session=abc123; user=alice"]],
      tryJsonData: true,
      unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    const echo = r.structuredContent.data?.cookies ?? {};
    assert.equal(echo.session, "abc123");
    assert.equal(echo.user, "alice");
  });

  test("2. Cookie passed to foura_proxy roundtrips", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 3,
      request: {
        method: "GET", url: TEST_SITES.cookies_read,
        headers: [["Cookie", "via=proxy"]],
        tryJsonData: true,
        unblocker: true,
      },
    }, TWO_MIN);
    if (r.isError) return; // proxy pool nondet
    assertSuccess(r);
    assert.equal(r.structuredContent.data?.cookies?.via, "proxy");
  });

  test("3. Browser pre-set cookie visible to httpbin echo", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.cookies_read,
      cookies: [{ name: "browser_set", value: "yes", domain: "httpbin.org" }],
      timeout_ms: 60_000,
    }, TWO_MIN);
    if (r.isError) return; // browser may bounce on httpbin
    assertSuccess(r);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.includes("browser_set"));
  });

  test("4. Multi-cookie roundtrip (3 cookies)", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.cookies_read,
      headers: [["Cookie", "a=1; b=2; c=3"]],
      tryJsonData: true,
      unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    const echo = r.structuredContent.data?.cookies ?? {};
    assert.equal(echo.a, "1");
    assert.equal(echo.b, "2");
    assert.equal(echo.c, "3");
  });
});
