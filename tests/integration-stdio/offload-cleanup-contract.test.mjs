// A payload directory is a cache on disk, and something outside this process may clean it.
// A long-running server must keep offloading after its key's directory is removed, and a
// payload whose files are gone must read as "not found", never as a raw filesystem error.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { getResourceLink, getTextContent } from "../helpers/assertions.mjs";

const KEY = "pk_live_test_dummy";
const BIG = "x".repeat(60_000);

let mockServer;
let client;
let payloadDir;

before(async () => {
  payloadDir = await mkdtemp(path.join(tmpdir(), "foura-mcp-offload-cleanup-"));
  mockServer = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.startsWith("/browser")) {
      res.end(JSON.stringify({ status: 200, headers: { "content-type": "text/html" }, body: BIG }));
    } else {
      res.end(JSON.stringify({ status: 200, headers: [{ "content-type": "text/plain" }], data: BIG, total_time: 0.1 }));
    }
  });
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  client = await spawnLocalServer({
    FOURA_API_KEY: KEY,
    FOURA_API_BASE: `http://127.0.0.1:${mockServer.address().port}`,
    FOURA_MCP_PAYLOADS_DIR: payloadDir,
  });
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => mockServer?.close(resolve));
  await rm(payloadDir, { recursive: true, force: true });
});

async function offload(tool) {
  const args = tool === "foura_browser"
    ? { url: "https://1.1.1.1/", offload_large: true }
    : { method: "GET", url: "https://1.1.1.1/", offload_large: true };
  const r = await client.callTool(tool, args);
  assert.ok(!r.isError, `${tool} failed: ${getTextContent(r)}`);
  const link = getResourceLink(r);
  assert.ok(link, `${tool} returned no resource_link: ${getTextContent(r)}`);
  return link;
}

async function readBack(link) {
  const read = await client.readResource(link.uri);
  assert.equal(read?.contents?.[0]?.text, BIG, `resources/read of ${link.uri} did not return the body`);
}

async function removeTenantDirs() {
  for (const entry of await readdir(payloadDir)) {
    await rm(path.join(payloadDir, entry), { recursive: true, force: true });
  }
}

describe("offload survives a cleanup of the payload directory", () => {
  for (const tool of ["foura_single", "foura_browser"]) {
    test(`${tool}: offload, the key's directory is removed, offload again and read it back`, async () => {
      await readBack(await offload(tool));
      await removeTenantDirs();
      await readBack(await offload(tool));
    });
  }

  test("a payload whose body file is gone reads as not found, with no server path", async () => {
    const link = await offload("foura_single");
    const uuid = link.uri.replace("foura-mcp://payload/", "");
    const [dir] = await readdir(payloadDir);
    const dataPath = path.join(payloadDir, dir, `${uuid}.bin`);
    assert.ok(existsSync(dataPath));
    await rm(dataPath);
    const resp = await client.send("resources/read", { uri: link.uri });
    assert.ok(resp.error, "reading a payload with no body must fail");
    assert.match(resp.error.message, /Payload not found/);
    assert.doesNotMatch(resp.error.message, /ENOENT|\.bin|\//);
  });
});
