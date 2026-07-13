// Real-site sanity coverage.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

describe("real-site regression targets", () => {
  test("1. example.com via foura_single", async () => {
    const r = await client.callTool("foura_single", { method: "GET", url: TEST_SITES.static }, TWO_MIN);
    assertSuccess(r);
    assert.ok(String(r.structuredContent.data).includes("Example"));
  });

  test("2. Hacker News server-rendered", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.hackernews, unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    const body = String(r.structuredContent.data);
    assert.ok(body.toLowerCase().includes("ycombinator") || body.toLowerCase().includes("hacker news"));
  });

  test("3. Wikipedia (~150KB) - default inline (regression default behavior)", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    assert.ok(r.structuredContent.data, "default should be inline");
    assert.equal(r.structuredContent.offloaded_resource_uri, undefined);
  });

  test("4. techmart.bg product page via foura_browser", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.techmart_phone, timeout_ms: 60_000,
    }, TWO_MIN);
    if (r.isError) {
      // Anti-bot or transient failure - surface as structured envelope, never bare error.
      assert.equal(r.structuredContent?.service, "browser");
      return;
    }
    assertSuccess(r);
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    assert.ok(bodyStr.length > 1000, "techmart product page body should be substantial");
  });

  test("5. onlinemashini.com via foura_browser", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.onlinemashini, timeout_ms: 60_000,
    }, TWO_MIN);
    if (r.isError) {
      assert.equal(r.structuredContent?.service, "browser");
      return;
    }
    assertSuccess(r);
  });

  test("6. github.com server-rendered via foura_single", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: "https://github.com", followRedirects: 5, unblocker: true,
    }, TWO_MIN);
    if (r.isError) {
      // GitHub can rate-limit unauthed requests - accept envelope.
      assert.equal(r.structuredContent?.service, "single");
      return;
    }
    assertSuccess(r);
    const body = String(r.structuredContent.data ?? "");
    assert.ok(body.toLowerCase().includes("github") || body.toLowerCase().includes("<html"));
  });
});
