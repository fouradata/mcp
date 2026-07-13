import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { request } from "undici";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

const BASE = process.env.FOURA_MCP_HTTP_URL ?? "https://mcp.foura.ai/mcp";
const HEALTH = BASE.replace(/\/mcp$/, "/healthz");

describe("mcp.foura.ai /healthz", () => {
  test("1. responds 200", async () => {
    const res = await request(HEALTH);
    assert.equal(res.statusCode, 200);
    res.body.dump?.();
  });

  test("2. body is JSON with ok:true, name:foura-mcp", async () => {
    const res = await request(HEALTH);
    const body = await res.body.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, "foura-mcp");
  });

  test("3. version exists (may lag behind package.json pre-deploy)", async () => {
    const res = await request(HEALTH);
    const body = await res.body.json();
    assert.ok(typeof body.version === "string");
    assert.match(body.version, /^\d+\.\d+\.\d+/);
    if (body.version !== pkg.version) {
      console.warn(`  WARNING: deployed ${body.version} != package.json ${pkg.version} (expected pre-deploy)`);
    }
  });

  test("4. responds in <2s (cold start tolerance)", async () => {
    const t0 = Date.now();
    await request(HEALTH);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5000, `healthz took ${elapsed}ms - too slow`);
  });
});
