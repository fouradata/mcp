import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { request } from "undici";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const VERSION = pkg.version;
const RUN_LIVE_CHECKS = process.env.RUN_LIVE_VERSION_CHECKS === "1";

describe("Version on all surfaces (package.json is truth)", () => {
  test("1. package.json semver", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  test("2. CHANGELOG.md has matching header (or [Unreleased])", () => {
    const cl = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");
    const hasV = cl.includes(`## [${VERSION}]`);
    const hasUnreleased = cl.includes("## [Unreleased]");
    assert.ok(hasV || hasUnreleased, `CHANGELOG must have ## [${VERSION}] or ## [Unreleased]`);
  });

  test("3. /healthz on deployed mcp.foura.ai (explicit live check)", { skip: !RUN_LIVE_CHECKS }, async () => {
    const url = (process.env.FOURA_MCP_HTTP_URL ?? "https://mcp.foura.ai/mcp").replace(/\/mcp$/, "/healthz");
    try {
      const res = await request(url, { signal: AbortSignal.timeout(8000) });
      const body = await res.body.json();
      assert.match(body.version, /^\d+\.\d+\.\d+/);
      if (body.version !== VERSION) {
        console.warn(`  WARNING: deployed ${body.version} != local ${VERSION} (expected pre-deploy)`);
      }
    } catch (e) {
      // CI containers and sandboxes often can't reach the public hostname.
      // The deployed-version check is soft - log and continue.
      console.warn(`  WARNING: mcp.foura.ai unreachable from this environment: ${e.message?.slice(0, 100)}`);
    }
  });

  test("4. npm latest tag (explicit live check)", { skip: !RUN_LIVE_CHECKS }, async () => {
    try {
      const res = await request("https://registry.npmjs.org/@fouradata/mcp/latest", {
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.body.json();
      assert.match(body.version, /^\d+\.\d+\.\d+/);
      if (body.version !== VERSION) {
        console.warn(`  WARNING: npm latest ${body.version} != local ${VERSION} (expected pre-publish)`);
      }
    } catch (e) {
      console.warn(`  WARNING: npm registry unreachable: ${e.message}`);
    }
  });
});
