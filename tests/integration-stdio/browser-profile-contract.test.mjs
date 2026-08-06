import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";

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
  payloadDir = await mkdtemp(path.join(tmpdir(), "foura-mcp-browser-profile-"));
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
const PROFILE_FIELDS = ["profile", "browser", "os", "version"];

describe("browser profile selection contract", () => {
  test("tools/list publishes the profile fields on foura_single and foura_proxy", async () => {
    const tools = await client.listTools();
    const single = tools.find((tool) => tool.name === "foura_single");
    const proxy = tools.find((tool) => tool.name === "foura_proxy");
    assert.ok(single);
    assert.ok(proxy);

    for (const field of PROFILE_FIELDS) {
      assert.equal(single.inputSchema?.properties?.[field]?.type, "string", `single.${field}`);
      assert.equal(
        proxy.inputSchema?.properties?.request?.properties?.[field]?.type,
        "string",
        `proxy.request.${field}`,
      );
    }

    assert.match(single.inputSchema.properties.profile.description, /api\.foura\.ai\/api\/profiles/);
    assert.match(single.inputSchema.properties.browser.description, /Chrome, Edge, Safari, Firefox, or Tor/);
    assert.match(single.inputSchema.properties.os.description, /Windows, macOS, Android, or iOS/);
    assert.match(single.inputSchema.properties.version.description, /newest match wins/i);
    assert.match(
      single.inputSchema.properties.version.description,
      /no other browser is substituted/i,
      "the no-silent-substitution contract must stay published",
    );
  });

  test("tools/list states that the unblocker defaults to on", async () => {
    const tools = await client.listTools();
    for (const [name, schema] of [
      ["foura_single", (tool) => tool.inputSchema?.properties?.unblocker],
      ["foura_proxy", (tool) => tool.inputSchema?.properties?.request?.properties?.unblocker],
    ]) {
      const tool = tools.find((entry) => entry.name === name);
      const description = schema(tool)?.description ?? "";
      assert.match(description, /Default true/, `${name} unblocker default`);
      assert.doesNotMatch(description, /Default false/, `${name} must not claim the old default`);
    }
  });

  test("foura_single forwards the profile fields in the existing upstream request", async () => {
    enqueue({ status: 200, data: "ok", total_time: 0.2 });
    const beforeCount = requests.length;
    const result = await client.callTool("foura_single", {
      ...target,
      browser: "Firefox",
      os: "Windows",
      version: "147",
    });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, beforeCount + 1, "exactly one upstream request");
    assert.equal(requests.at(-1).url, "/single/");
    assert.equal(requests.at(-1).body.browser, "Firefox");
    assert.equal(requests.at(-1).body.os, "Windows");
    assert.equal(requests.at(-1).body.version, "147");
  });

  test("foura_single forwards an exact profile id unchanged", async () => {
    enqueue({ status: 200, data: "ok", total_time: 0.2 });
    const result = await client.callTool("foura_single", { ...target, profile: "chrome146" });

    assert.notEqual(result.isError, true);
    assert.equal(requests.at(-1).body.profile, "chrome146");
  });

  test("foura_proxy nests the profile fields inside the inner request", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", total: 0.3 });
    const beforeCount = requests.length;
    const result = await client.callTool("foura_proxy", {
      request: { ...target, browser: "Safari", os: "iOS", version: "18.4" },
    });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, beforeCount + 1, "exactly one upstream request");
    assert.equal(requests.at(-1).url, "/proxy/");
    assert.equal(requests.at(-1).body.request.browser, "Safari");
    assert.equal(requests.at(-1).body.request.os, "iOS");
    assert.equal(requests.at(-1).body.request.version, "18.4");
    assert.equal(Object.hasOwn(requests.at(-1).body, "browser"), false, "must not leak to the outer body");
  });

  test("a request without profile fields sends none of them", async () => {
    enqueue({ status: 200, data: "ok", total_time: 0.2 });
    await client.callTool("foura_single", target);
    for (const field of PROFILE_FIELDS) {
      assert.equal(Object.hasOwn(requests.at(-1).body, field), false, `${field} must not be defaulted`);
    }

    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", total: 0.3 });
    await client.callTool("foura_proxy", { request: target });
    for (const field of PROFILE_FIELDS) {
      assert.equal(Object.hasOwn(requests.at(-1).body.request, field), false, `request.${field} must not be defaulted`);
    }
  });

  test("an unavailable profile is returned as an error, not another browser", async () => {
    enqueue({
      error: "no profile matches browser=Safari os=Windows 10 version=*; available for that browser: macOS Tahoe 26.0",
      status: 0,
      total_time: 0,
    });
    const result = await client.callTool("foura_single", {
      ...target,
      browser: "Safari",
      os: "Windows 10",
    });

    assert.equal(result.isError, true);
    assert.match(result.structuredContent.error, /no profile matches browser=Safari/);
    assert.match(result.structuredContent.error, /available for that browser/);
  });

  test("a profile without the unblocker is returned as an error", async () => {
    enqueue({
      error: "browser profile selection requires unblocker:true",
      status: 0,
      total_time: 0,
    });
    const result = await client.callTool("foura_single", {
      ...target,
      unblocker: false,
      browser: "Chrome",
    });

    assert.equal(result.isError, true);
    assert.match(result.structuredContent.error, /requires unblocker:true/);
    assert.equal(requests.at(-1).body.unblocker, false);
  });

  test("a bot-check result reaches the caller on both tools", async () => {
    enqueue({ status: 200, data: "real page", total_time: 0.4, defense: { solved: true } });
    const single = await client.callTool("foura_single", { ...target, browser: "Chrome" });
    assert.notEqual(single.isError, true);
    assert.equal(single.structuredContent.defense.solved, true);

    enqueue({ status: 200, data: "challenge", proxy: "A1B2C3", total: 0.5, defense: { solved: false } });
    const proxy = await client.callTool("foura_proxy", { request: { ...target, browser: "Chrome" } });
    assert.notEqual(proxy.isError, true);
    assert.equal(proxy.structuredContent.defense.solved, false);
  });

  test("tools/list documents what to do when a bot check was not met", async () => {
    const tools = await client.listTools();
    for (const name of ["foura_single", "foura_proxy"]) {
      const tool = tools.find((entry) => entry.name === name);
      const description = tool.outputSchema?.properties?.defense?.description ?? "";
      assert.match(description, /retry with a different browser, os, or version/i, `${name} defense guidance`);
    }
  });

  test("foura_auto points at the tools that choose the browser", async () => {
    const tools = await client.listTools();
    const auto = tools.find((entry) => entry.name === "foura_auto");
    assert.match(auto.description, /foura_single and foura_proxy/);
    for (const field of PROFILE_FIELDS) {
      assert.equal(
        Object.hasOwn(auto.inputSchema?.properties ?? {}, field),
        false,
        `foura_auto must not advertise ${field}: the upstream contract has no such input`,
      );
    }
  });
});
