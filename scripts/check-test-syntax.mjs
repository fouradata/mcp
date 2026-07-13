#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(ROOT, "tests");

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collect(path));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

const failures = [];
const files = collect(TESTS).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(`${relative(ROOT, file)}\n${result.stderr || result.stdout}`);
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed for ${failures.length} test file(s):\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} test files.`);
