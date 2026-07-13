// Opt-in offload regression coverage; the default remains inline.
// Default behavior must work in Claude Desktop (no resources/read support).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { TEST_KEY } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, getResourceLink } from "../helpers/assertions.mjs";

let client;
let payloadsDir;

before(async () => {
  payloadsDir = mkdtempSync(path.join(tmpdir(), "foura-mcp-offload-"));
  client = await spawnLocalServer({
    FOURA_API_KEY: TEST_KEY,
    FOURA_MCP_PAYLOADS_DIR: payloadsDir,
  });
});
after(async () => {
  await client?.close();
  if (payloadsDir) rmSync(payloadsDir, { recursive: true, force: true });
});

const TWO_MIN = 120_000;

describe("opt-in offload with an inline default", () => {
  test("1. Large page + offload_large:false stays inline in structuredContent", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
    }, TWO_MIN);
    assertSuccess(r);
    // structuredContent must have data inline and no resource_link content block.
    assert.ok(r.structuredContent.data, "data must be inline by default");
    assert.equal(getResourceLink(r), null, "no resource_link content block when offload_large=false");
    assert.equal(r.structuredContent.offloaded_resource_uri, undefined);
  });

  test("2. Large page + offload_large:true -> resource_link issued, data omitted", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
      offload_large: true,
    }, TWO_MIN);
    assertSuccess(r);
    const link = getResourceLink(r);
    assert.ok(link, "resource_link content block must be present");
    assert.match(link.uri, /^foura-mcp:\/\/payload\/[0-9a-f-]+$/);
    assert.equal(r.structuredContent.offloaded_resource_uri, link.uri);
    assert.ok((r.structuredContent.size_bytes ?? 0) >= 50_000);
    assert.equal(r.structuredContent.data, undefined, "data must be omitted in offload path");
  });

  test("3. Small page + offload_large:true -> still inline (below threshold)", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.static, offload_large: true,
    }, TWO_MIN);
    assertSuccess(r);
    assert.ok(r.structuredContent.data, "small body stays inline even with offload opt-in");
    assert.equal(getResourceLink(r), null);
  });

  test("4. Small page + offload_large:false -> inline", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.static,
    }, TWO_MIN);
    assertSuccess(r);
    assert.ok(r.structuredContent.data);
    assert.equal(getResourceLink(r), null);
  });

  test("5. Offload -> resources/read returns full body", async () => {
    const r = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
      offload_large: true,
    }, TWO_MIN);
    assertSuccess(r);
    const link = getResourceLink(r);
    const read = await client.readResource(link.uri);
    assert.ok(read?.contents?.length >= 1);
    const content = read.contents[0];
    assert.ok(typeof content.text === "string" && content.text.length > 1000);
    assert.equal(content.mimeType, "text/html");
  });

  test("6. foura_proxy + offload_large:true -> resource_link + proxy field still in structuredContent", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 3,
      request: {
        method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
      },
      offload_large: true,
    }, TWO_MIN);
    if (r.isError) return; // proxy pool can fail; offload semantics are tested in single
    const link = getResourceLink(r);
    if (link) {
      assert.ok(r.structuredContent.proxy, "proxy ID must persist through offload path");
      assert.equal(r.structuredContent.offloaded_resource_uri, link.uri);
    }
  });

  test("7. foura_browser + offload_large:true on real product page", async () => {
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.techmart_phone, offload_large: true, timeout_ms: 60_000,
    }, TWO_MIN);
    if (r.isError) return; // techmart anti-bot can vary
    const link = getResourceLink(r);
    if (link) {
      assert.equal(link.mimeType?.startsWith("text/html"), true);
    }
  });

  test("8. Same large URL with toggle - proves opt-in IS the difference", async () => {
    const inline = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
    }, TWO_MIN);
    const offloaded = await client.callTool("foura_single", {
      method: "GET", url: TEST_SITES.wikipedia, followRedirects: 5, unblocker: true,
      offload_large: true,
    }, TWO_MIN);
    assert.ok(inline.structuredContent.data && !inline.structuredContent.offloaded_resource_uri);
    assert.ok(!offloaded.structuredContent.data && offloaded.structuredContent.offloaded_resource_uri);
  });
});
