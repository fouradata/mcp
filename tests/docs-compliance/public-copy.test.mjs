import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
function collect(dir, relativeDir, extension) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const relative = path.join(relativeDir, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collect(absolute, relative, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(relative);
  }
  return files;
}

const PUBLIC_COPY_FILES = [...new Set([
  ...collect(REPO, "", ".md"),
  ...collect(path.join(REPO, "src"), "src", ".ts"),
  ...collect(path.join(REPO, "tests"), "tests", ".mjs"),
  ...collect(path.join(REPO, "scripts"), "scripts", ".mjs"),
  ...collect(path.join(REPO, ".github"), ".github", ".yml"),
  ...collect(path.join(REPO, ".github"), ".github", ".yaml"),
  "bin/foura-mcp.js",
  "package.json",
  "server.json",
  "glama.json",
  ".env.example",
  ".mcp.json",
  "smithery.yaml",
  "Dockerfile",
  "Dockerfile.stdio",
  "docker-compose.yml",
  "scripts/audit-tokens.mjs",
  "scripts/bump.mjs",
])]
  .filter((file) => file !== "tests/docs-compliance/public-copy.test.mjs")
  .sort();

const FORBIDDEN_COPY = [
  { name: "headless browser wording", re: /\bheadless\b/i },
  { name: "curl implementation wording", re: /curl[-_]impersonate|\blibcurl\b/i },
  { name: "TLS fingerprint internals", re: /\bja[34]\b|tls\s+fingerprint/i },
  { name: "private routing narrative", re: /per-host\s+(?:proxy\s+)?(?:rating|scoring)|warm session|known-bad routes|learns? the right settings/i },
  { name: "private hosting narrative", re: /fixed container egress|FourA's own egress|FourA's origin IP/i },
  { name: "private response or gateway wording", re: /\bHeaderInfo\b|\bapi[\s-]?gateway\b/i },
  { name: "unsupported session claim", re: /same fingerprint/i },
  { name: "AI-style filler", re: /\b(?:delve|crucial|comprehensive|foster|innovative|leverage|game-changing|revolutionary|seamlessly|cutting-edge|robust|utilize|facilitate|groundbreaking|multifaceted)\b|it's worth noting|let's dive|in conclusion|to summarize|moving forward|without further ado|in today's|in an era|in a world where|we're (?:thrilled|excited|proud) to announce/i },
  { name: "shouty prose", re: /\b(?:PASSES|FAILS|FAILURE|SOLVE|STRONGLY|PRIMARY)\b/ },
  { name: "non-ASCII dash", re: /[\u2013\u2014]/ },
  { name: "decorative emoji", re: /[\u{1F300}-\u{1FAFF}\u2705\u274C\u26A0]/u },
];

describe("public package copy", () => {
  test("contains no private implementation copy, AI-style filler, em dashes, or decorative emoji", () => {
    const violations = [];
    for (const file of PUBLIC_COPY_FILES) {
      const text = readFileSync(path.join(REPO, file), "utf8");
      for (const { name, re } of FORBIDDEN_COPY) {
        if (re.test(text)) violations.push(`${file}: ${name}`);
      }
    }
    assert.deepEqual(violations, []);
  });
});
