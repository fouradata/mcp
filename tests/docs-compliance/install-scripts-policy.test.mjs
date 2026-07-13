import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(REPO, "package-lock.json"), "utf8"));

function dependencyName(lockPath) {
  return lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
}

test("dependency install scripts have exact-version approvals", () => {
  const required = Object.entries(lock.packages)
    .filter(([lockPath, metadata]) => lockPath.includes("node_modules/") && metadata.hasInstallScript)
    .map(([lockPath, metadata]) => `${dependencyName(lockPath)}@${metadata.version}`)
    .sort();

  const approved = Object.entries(pkg.allowScripts ?? {})
    .filter(([, allowed]) => allowed === true)
    .map(([dependency]) => dependency)
    .sort();

  assert.deepEqual(approved, required);
});
