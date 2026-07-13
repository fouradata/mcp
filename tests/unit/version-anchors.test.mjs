import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const serverManifest = JSON.parse(readFileSync(path.join(REPO, "server.json"), "utf8"));
const VERSION = pkg.version;

describe("version anchors - all release surfaces agree with package.json", () => {
  test(`1. package.json version is semver (${VERSION})`, () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  test("2. src/http.ts SERVER_VERSION matches", () => {
    const src = readFileSync(path.join(REPO, "src/http.ts"), "utf8");
    assert.ok(src.includes(`SERVER_VERSION = "${VERSION}"`), `http.ts missing SERVER_VERSION = "${VERSION}"`);
  });

  test("3. src/server.ts version matches", () => {
    const src = readFileSync(path.join(REPO, "src/server.ts"), "utf8");
    assert.ok(src.includes(`version: "${VERSION}"`), `server.ts missing version: "${VERSION}"`);
  });

  test("4. src/tools/single.ts User-Agent matches", () => {
    const src = readFileSync(path.join(REPO, "src/tools/single.ts"), "utf8");
    assert.ok(src.includes(`foura-mcp/${VERSION} (single)`));
  });

  test("5. src/tools/proxy.ts User-Agent matches", () => {
    const src = readFileSync(path.join(REPO, "src/tools/proxy.ts"), "utf8");
    assert.ok(src.includes(`foura-mcp/${VERSION} (proxy)`));
  });

  test("6. src/tools/browser.ts User-Agent matches", () => {
    const src = readFileSync(path.join(REPO, "src/tools/browser.ts"), "utf8");
    assert.ok(src.includes(`foura-mcp/${VERSION} (browser)`));
  });

  test("7. src/tools/auto.ts User-Agent matches", () => {
    const src = readFileSync(path.join(REPO, "src/tools/auto.ts"), "utf8");
    assert.ok(src.includes(`foura-mcp/${VERSION} (auto)`));
  });

  test("8. package-lock.json root versions match", () => {
    assert.equal(lock.version, VERSION);
    assert.equal(lock.packages?.[""]?.version, VERSION);
  });

  test("9. server.json registry versions match", () => {
    assert.equal(serverManifest.version, VERSION);
    assert.equal(serverManifest.packages?.[0]?.version, VERSION);
  });

  test("10. CHANGELOG.md latest entry header references current or [Unreleased]", () => {
    const cl = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");
    const hasUnreleased = cl.includes("## [Unreleased]");
    const hasVersion = cl.includes(`## [${VERSION}]`);
    assert.ok(hasUnreleased || hasVersion, `CHANGELOG must have ## [Unreleased] or ## [${VERSION}]`);
  });

  test("11. no stale pre-current version literals in src/", () => {
    // Catches sed-by-hand drift the bump script is designed to prevent.
    const files = [
      "src/http.ts",
      "src/server.ts",
      "src/tools/single.ts",
      "src/tools/proxy.ts",
      "src/tools/browser.ts",
      "src/tools/auto.ts",
    ];
    for (const f of files) {
      const src = readFileSync(path.join(REPO, f), "utf8");
      const matches = src.matchAll(/foura-mcp\/(\d+\.\d+\.\d+)/g);
      for (const m of matches) {
        assert.equal(m[1], VERSION, `${f} mentions foura-mcp/${m[1]} but package.json is ${VERSION}`);
      }
    }
  });
});
