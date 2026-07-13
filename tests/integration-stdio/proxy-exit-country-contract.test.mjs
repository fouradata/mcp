import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { getResourceLink, getTextContent } from "../helpers/assertions.mjs";

let mockServer;
let client;
let payloadDir;
let apiBase;
const requests = [];
const responses = [];

function enqueue(body, status = 200) {
  responses.push({ body, status });
}

before(async () => {
  payloadDir = await mkdtemp(path.join(tmpdir(), "foura-mcp-exit-country-"));
  mockServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: req.method, url: req.url, body: JSON.parse(raw) });
    const next = responses.shift();
    if (!next) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected mock request" }));
      return;
    }
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(JSON.stringify(next.body));
  });
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  const address = mockServer.address();
  apiBase = `http://127.0.0.1:${address.port}`;
  client = await spawnLocalServer({
    FOURA_API_KEY: "pk_live_test_dummy",
    FOURA_API_BASE: apiBase,
    FOURA_MCP_PAYLOADS_DIR: payloadDir,
  });
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => mockServer?.close(resolve));
  await rm(payloadDir, { recursive: true, force: true });
});

const target = { method: "GET", url: "https://1.1.1.1/" };

describe("foura_proxy exit-country handler contract", () => {
  test("tools/list publishes the exit-country item pattern", async () => {
    const tools = await client.listTools();
    const proxy = tools.find((tool) => tool.name === "foura_proxy");
    assert.ok(proxy);
    assert.equal(proxy.inputSchema?.properties?.exitCountries?.minItems, 1);
    assert.equal(proxy.inputSchema?.properties?.exitCountries?.items?.pattern, "^[A-Z]{2}$");
    assert.equal(proxy.outputSchema?.properties?.exitCountry?.pattern, "^[A-Z]{2}$");
    assert.match(proxy.outputSchema?.properties?.code?.description ?? "", /do not propose or perform an unscoped fallback/i);
    assert.match(proxy.outputSchema?.properties?.details?.description ?? "", /preserve this scope.*retry later/i);
  });

  test("normalizes and forwards exitCountries in the existing single upstream request", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", exitCountry: "CZ", total: 0.2 });
    const beforeCount = requests.length;
    const result = await client.callTool("foura_proxy", {
      exitCountries: [" cz ", "GB", "CZ"],
      request: target,
    });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, beforeCount + 1);
    assert.deepEqual(requests.at(-1).body.exitCountries, ["CZ", "GB"]);
    assert.equal(requests.at(-1).url, "/proxy/");
    assert.equal(result.structuredContent.exitCountry, "CZ");
    assert.match(getTextContent(result), /exit CZ/);
  });

  test("keeps an unscoped request and response backward compatible", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", total: 0.2 });
    const result = await client.callTool("foura_proxy", { request: target });

    assert.notEqual(result.isError, true);
    assert.equal(Object.hasOwn(requests.at(-1).body, "exitCountries"), false);
    assert.equal(Object.hasOwn(result.structuredContent, "exitCountry"), false);
  });

  test("preserves no_eligible_proxy from a transport-200 structured error", async () => {
    enqueue({
      error: "No eligible proxy matches the requested exit countries",
      request: { exitCountries: ["ZZ"], request: target },
      total: 0,
      code: "no_eligible_proxy",
      details: { exitCountries: ["ZZ"] },
    });
    const result = await client.callTool("foura_proxy", {
      exitCountries: ["ZZ"],
      request: target,
    });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "no_eligible_proxy");
    assert.deepEqual(result.structuredContent.details.exitCountries, ["ZZ"]);
  });

  test("rejects malformed scopes before making an upstream request", async () => {
    const beforeCount = requests.length;
    for (const exitCountries of [[], ["USA"], ["1A"]]) {
      const result = await client.callTool("foura_proxy", { exitCountries, request: target });
      assert.equal(result.isError, true);
    }
    assert.equal(requests.length, beforeCount);
  });

  test("retains exitCountry on the offloaded response path", async () => {
    enqueue({
      status: 200,
      headers: [{ "content-type": "text/plain" }],
      data: "x".repeat(50_001),
      proxy: "A1B2C3",
      exitCountry: "GB",
      total: 0.3,
    });
    const result = await client.callTool("foura_proxy", {
      exitCountries: ["GB"],
      offload_large: true,
      request: target,
    });

    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.exitCountry, "GB");
    assert.equal(Object.hasOwn(requests.at(-1).body, "offload_large"), false);
    assert.ok(getResourceLink(result));
  });
});
