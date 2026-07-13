// Tenant-isolation regression coverage for offloaded content.
// Store a payload as tenant A -> confirm tenant B can't read it via
// resources/read on the same URI.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { TEST_KEY } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess, getResourceLink } from "../helpers/assertions.mjs";

let clientA, clientB;
let payloadsDir;

before(async () => {
  payloadsDir = mkdtempSync(path.join(tmpdir(), "foura-mcp-isolation-"));
  // Tenant A uses the real test key - needed for the upstream call to succeed.
  clientA = await spawnLocalServer({
    FOURA_API_KEY: TEST_KEY,
    FOURA_MCP_PAYLOADS_DIR: payloadsDir,
  });
  // Tenant B uses a different key value. Upstream will reject any tool call,
  // but resources/read is local-only and never reaches the upstream API.
  clientB = await spawnLocalServer({
    FOURA_API_KEY: "pk_live_tenant_B_isolation_test",
    FOURA_MCP_PAYLOADS_DIR: payloadsDir,
  });
});
after(async () => {
  await clientA?.close();
  await clientB?.close();
  if (payloadsDir) rmSync(payloadsDir, { recursive: true, force: true });
});

const TWO_MIN = 120_000;

describe("tenant isolation for offloaded content", () => {
  test("1. Tenant A offloads a large page -> resource_link issued", async () => {
    const r = await clientA.callTool("foura_single", {
      method: "GET",
      url: TEST_SITES.wikipedia,
      followRedirects: 5,
      unblocker: true,
      offload_large: true,
    }, TWO_MIN);
    assertSuccess(r);
    const link = getResourceLink(r);
    assert.ok(link, "expected resource_link");
    globalThis.__isolationUri = link.uri;
  });

  test("2. Tenant A can read its own payload back", async () => {
    const uri = globalThis.__isolationUri;
    assert.ok(uri, "previous test must have set URI");
    const read = await clientA.readResource(uri);
    assert.ok(read?.contents?.length >= 1, "tenant A should read its own payload");
    assert.ok(typeof read.contents[0].text === "string" && read.contents[0].text.length > 1000);
  });

  test("3. Tenant B (different API key) CANNOT read tenant A's payload", async () => {
    const uri = globalThis.__isolationUri;
    // Send the raw JSON-RPC request directly so we can inspect error vs result
    // without the helper swallowing the discriminator.
    const resp = await clientB.send("resources/read", { uri }, 30_000);
    // Failure path: SDK returns either error envelope OR empty contents.
    const leaked = resp.result?.contents?.length > 0
      && typeof resp.result.contents[0].text === "string"
      && resp.result.contents[0].text.length > 100;
    assert.equal(leaked, false, `tenant B should NOT receive payload contents; got ${JSON.stringify(resp.result?.contents?.[0]?.text?.slice(0, 100))}`);
    // The error message (if any) must not include any of tenant A's data.
    const errMsg = String(resp.error?.message ?? resp.result?.contents?.[0]?.text ?? "");
    assert.ok(!errMsg.includes("Wikipedia") && !errMsg.includes("<html"), "no payload contents in error message");
  });

  test("4. Tenant A still can re-read after Tenant B's failed attempt", async () => {
    const uri = globalThis.__isolationUri;
    const read = await clientA.readResource(uri);
    assert.ok(read?.contents?.length >= 1);
  });
});
