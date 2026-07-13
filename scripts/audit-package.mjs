#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: ROOT,
  encoding: "utf8",
});
const reports = JSON.parse(raw);
const report = reports[0];
if (!report || !Array.isArray(report.files)) {
  console.error("npm pack did not return a file manifest");
  process.exit(1);
}

const allowedExact = new Set(["LICENSE", "README.md", "package.json"]);
const allowedPrefixes = ["bin/", "dist/"];
const unexpected = report.files
  .map((entry) => entry.path)
  .filter((path) => !allowedExact.has(path) && !allowedPrefixes.some((prefix) => path.startsWith(prefix)));

const required = ["bin/foura-mcp.js", "dist/http.js", "dist/server.js", "dist/stdio.js"];
const paths = new Set(report.files.map((entry) => entry.path));
const missing = required.filter((path) => !paths.has(path));

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) console.error(`Unexpected package files:\n${unexpected.join("\n")}`);
  if (missing.length > 0) console.error(`Missing package files:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`Package audit passed: ${report.entryCount} files, ${report.unpackedSize} unpacked bytes.`);
