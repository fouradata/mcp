#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/verify-release-tag.mjs vX.Y.Z");
  process.exit(2);
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const server = readJson("server.json");
const expectedTag = `v${pkg.version}`;
const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");

const failures = [];
if (tag !== expectedTag) failures.push(`tag ${tag} does not match ${expectedTag}`);
if (lock.version !== pkg.version) failures.push("package-lock.json top-level version mismatch");
if (lock.packages?.[""]?.version !== pkg.version) failures.push("package-lock.json root package version mismatch");
if (server.version !== pkg.version) failures.push("server.json top-level version mismatch");
if (server.packages?.[0]?.version !== pkg.version) failures.push("server.json npm package version mismatch");
if (!changelog.match(new RegExp(`^## \\[${pkg.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"))) {
  failures.push(`CHANGELOG.md is missing a dated ${pkg.version} release header`);
}

if (failures.length > 0) {
  console.error(`Release tag verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Release tag verification passed for ${tag}.`);
