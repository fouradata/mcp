#!/usr/bin/env node
/**
 * Bump version across all six places at once.
 *
 * Usage:  node scripts/bump.mjs <patch|minor|major>
 *   or:   npm run bump <patch|minor|major>
 *
 * Refuses to run if the six version anchors are out of sync (= someone
 * sed'd by hand and broke the invariant). Refuses to run if the git tree
 * is dirty (commit first, then bump).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("Usage: node scripts/bump.mjs <patch|minor|major>");
  process.exit(2);
}

// 1. Refuse if git tree is dirty.
const gitStatus = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
if (gitStatus) {
  console.error("git tree is dirty — commit or stash first.\n" + gitStatus);
  process.exit(3);
}

// 2. Resolve all six anchor points + their expected current value.
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const current = pkg.version;
console.log(`current version: ${current}`);

const ANCHORS = [
  { file: "package.json",         pattern: `"version": "${current}"`,       replacement: (v) => `"version": "${v}"` },
  { file: "src/http.ts",          pattern: `SERVER_VERSION = "${current}"`, replacement: (v) => `SERVER_VERSION = "${v}"` },
  { file: "src/server.ts",        pattern: `version: "${current}"`,         replacement: (v) => `version: "${v}"` },
  { file: "src/tools/single.ts",  pattern: `foura-mcp/${current} (single)`,  replacement: (v) => `foura-mcp/${v} (single)` },
  { file: "src/tools/proxy.ts",   pattern: `foura-mcp/${current} (proxy)`,   replacement: (v) => `foura-mcp/${v} (proxy)` },
  { file: "src/tools/browser.ts", pattern: `foura-mcp/${current} (browser)`, replacement: (v) => `foura-mcp/${v} (browser)` },
  { file: "src/tools/auto.ts",    pattern: `foura-mcp/${current} (auto)`,    replacement: (v) => `foura-mcp/${v} (auto)` },
];

// 3. Validate — every anchor must contain the current version literal.
const missing = [];
for (const a of ANCHORS) {
  const text = readFileSync(resolve(ROOT, a.file), "utf8");
  if (!text.includes(a.pattern)) missing.push(a);
}
if (missing.length) {
  console.error(`\nVersion anchors out of sync — these files don't contain the expected "${current}" pattern:`);
  for (const a of missing) console.error(`  ${a.file}  expected:  ${a.pattern}`);
  console.error("\nFix by hand to match package.json, commit, then re-run bump.");
  process.exit(4);
}

// 4. Compute next version.
const [maj, min, pat] = current.split(".").map(Number);
let next;
if (kind === "patch") next = `${maj}.${min}.${pat + 1}`;
if (kind === "minor") next = `${maj}.${min + 1}.0`;
if (kind === "major") next = `${maj + 1}.0.0`;
console.log(`bumping ${kind}: ${current} → ${next}\n`);

// 5. Apply.
for (const a of ANCHORS) {
  const path = resolve(ROOT, a.file);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(a.pattern, a.replacement(next)));
  console.log(`  ✓ ${a.file}`);
}

// 6. Post-flight: scan for stale current-version literals anywhere in src/ + package.json.
//    These are usually comments or sourcemap residue — flag them so we don't ship a half-updated tarball.
let stale;
try {
  stale = execSync(
    `grep -rln "${current}" src/ package.json package-lock.json 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf8" },
  ).trim().split("\n").filter(Boolean);
} catch {
  stale = [];
}
if (stale.length) {
  console.log(`\n⚠ Stale "${current}" references still in:`);
  for (const f of stale) console.log(`  ${f}`);
  console.log("  (package-lock.json is fine — npm install regenerates it. Others: inspect manually.)");
}

console.log(`\nNext steps:`);
console.log(`  1. Add a [${next}] entry to CHANGELOG.md`);
console.log(`  2. npm run lint && npm run build`);
console.log(`  3. npm run audit:tokens`);
console.log(`  4. git add -A && git commit -m "release v${next}: <one-line summary>"`);
console.log(`  5. git push   (CI will redeploy)`);
console.log(`  6. Tag + push; CI publishes to npm (with provenance).`);
