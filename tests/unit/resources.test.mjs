import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let storePayload, THRESHOLD_BYTES, hashApiKey, withApiKey;

describe("resources - THRESHOLD_BYTES + storePayload (tenant-isolated)", () => {
  test("1. THRESHOLD_BYTES === 50_000", async () => {
    process.env.FOURA_MCP_PAYLOADS_DIR = mkdtempSync(path.join(tmpdir(), "foura-mcp-test-"));
    process.env.FOURA_API_KEY = "pk_live_unit_test_default_key";
    ({ storePayload, THRESHOLD_BYTES, hashApiKey } = await import("../../dist/resources.js"));
    ({ withApiKey } = await import("../../dist/auth.js"));
    assert.equal(THRESHOLD_BYTES, 50_000);
  });

  test("2. 49999 bytes < THRESHOLD", () => {
    assert.ok(Buffer.byteLength("a".repeat(49999), "utf8") < THRESHOLD_BYTES);
  });

  test("3. 50001 bytes >= THRESHOLD", () => {
    assert.ok(Buffer.byteLength("a".repeat(50001), "utf8") >= THRESHOLD_BYTES);
  });

  test("4. UTF-8 multibyte: 25000 four-byte characters reach the threshold", () => {
    assert.ok(Buffer.byteLength("\u{1F680}".repeat(25000), "utf8") >= THRESHOLD_BYTES);
  });

  test("5. storePayload returns URI with prefix", async () => {
    const stored = await storePayload("hello", "text/plain", "x.txt");
    assert.match(stored.uri, /^foura-mcp:\/\/payload\/[0-9a-f-]{36}$/);
  });

  test("6. mimeType roundtrips", async () => {
    const stored = await storePayload("body", "application/json", "data.json");
    assert.equal(stored.mimeType, "application/json");
  });

  test("7. size matches Buffer.byteLength of input", async () => {
    const data = "hello world";
    const stored = await storePayload(data, "text/plain", "x.txt");
    assert.equal(stored.size, Buffer.byteLength(data, "utf8"));
  });

  test("8. name matches suggestedName", async () => {
    const stored = await storePayload("x", "text/plain", "page-1.html");
    assert.equal(stored.name, "page-1.html");
  });

  test("9. distinct UUIDs across calls", async () => {
    const a = await storePayload("1", "text/plain", "a");
    const b = await storePayload("2", "text/plain", "b");
    assert.notEqual(a.uri, b.uri);
  });

  test("10. binary buffer preserved (meta.binary=true)", async () => {
    const buf = Buffer.from([0x00, 0xff, 0x42]);
    const stored = await storePayload(buf, "application/octet-stream", "x.bin");
    const uuid = stored.uri.replace("foura-mcp://payload/", "");
    const keyhash = hashApiKey(process.env.FOURA_API_KEY);
    const metaPath = path.join(process.env.FOURA_MCP_PAYLOADS_DIR, keyhash, `${uuid}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    assert.equal(meta.binary, true);
  });

  test("11. payload written under <PAYLOADS_DIR>/<keyhash>/ (tenant namespace)", async () => {
    const stored = await storePayload("tenant-A-data", "text/plain", "a.txt");
    const uuid = stored.uri.replace("foura-mcp://payload/", "");
    const keyhash = hashApiKey(process.env.FOURA_API_KEY);
    const dataPath = path.join(process.env.FOURA_MCP_PAYLOADS_DIR, keyhash, `${uuid}.bin`);
    assert.ok(existsSync(dataPath), `expected ${dataPath} to exist`);
    // And NOT in the bare PAYLOADS_DIR (pre-isolation layout).
    const oldPath = path.join(process.env.FOURA_MCP_PAYLOADS_DIR, `${uuid}.bin`);
    assert.ok(!existsSync(oldPath), `legacy flat path ${oldPath} should not exist`);
  });

  test("12. two different keys use different namespace directories", async () => {
    const keyA = "pk_live_tenant_A_xxx";
    const keyB = "pk_live_tenant_B_yyy";
    const storedA = await withApiKey(keyA, () => storePayload("A", "text/plain", "a"));
    const storedB = await withApiKey(keyB, () => storePayload("B", "text/plain", "b"));
    const uuidA = storedA.uri.replace("foura-mcp://payload/", "");
    const uuidB = storedB.uri.replace("foura-mcp://payload/", "");
    const hashA = hashApiKey(keyA);
    const hashB = hashApiKey(keyB);
    assert.notEqual(hashA, hashB);
    assert.ok(existsSync(path.join(process.env.FOURA_MCP_PAYLOADS_DIR, hashA, `${uuidA}.bin`)));
    assert.ok(existsSync(path.join(process.env.FOURA_MCP_PAYLOADS_DIR, hashB, `${uuidB}.bin`)));
    // Tenant A's payload must NOT appear under tenant B's namespace.
    assert.ok(!existsSync(path.join(process.env.FOURA_MCP_PAYLOADS_DIR, hashB, `${uuidA}.bin`)));
  });

  test("13. hashApiKey is deterministic and 16 hex chars", () => {
    const h1 = hashApiKey("pk_live_xxx");
    const h2 = hashApiKey("pk_live_xxx");
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{16}$/);
  });

  test("14. meta sidecar carries keyhash for defense-in-depth check", async () => {
    const stored = await storePayload("tenant-meta-check", "text/plain", "x.txt");
    const uuid = stored.uri.replace("foura-mcp://payload/", "");
    const keyhash = hashApiKey(process.env.FOURA_API_KEY);
    const metaPath = path.join(process.env.FOURA_MCP_PAYLOADS_DIR, keyhash, `${uuid}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    assert.equal(meta.keyhash, keyhash);
  });

  test("15. cleanup", () => {
    rmSync(process.env.FOURA_MCP_PAYLOADS_DIR, { recursive: true, force: true });
  });
});
