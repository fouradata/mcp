#!/usr/bin/env node
/**
 * Estimate the serialized tools/list size and fail when it exceeds the context budget.
 * Set BUDGET_TOKENS to override the default ceiling.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Keep enough room for all four tool schemas without letting descriptions grow unchecked.
const BUDGET = Number(process.env.BUDGET_TOKENS ?? 11000);
const CHARS_PER_TOKEN = 3.5;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "dist", "stdio.js");

function estimateTokens(s) {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

async function fetchToolsList() {
  const child = spawn("node", [SERVER_ENTRY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, FOURA_API_KEY: "pk_live_audit_dummy" },
  });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;

  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  });

  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout for ${method}`));
        }
      }, 15_000);
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "audit", version: "0.0.1" },
  });
  notify("notifications/initialized");

  const resp = await send("tools/list", {});
  child.kill();
  return resp.result?.tools ?? [];
}

const tools = await fetchToolsList();
if (tools.length === 0) {
  console.error("audit-tokens: no tools returned from server");
  process.exit(2);
}

let total = 0;
console.log(`\nToken budget: ${BUDGET}  (chars/${CHARS_PER_TOKEN} estimate)\n`);
console.log("Per-tool breakdown:");
console.log("-".repeat(70));

for (const t of tools) {
  const nameChars = (t.name ?? "").length;
  const descChars = (t.description ?? "").length;
  const schemaChars = t.inputSchema ? JSON.stringify(t.inputSchema).length : 0;
  const titleChars = (t.title ?? "").length;
  const subtotal = nameChars + descChars + titleChars + schemaChars;
  const tokens = estimateTokens(JSON.stringify(t));
  total += tokens;

  console.log(`  ${t.name.padEnd(20)} ~${String(tokens).padStart(4)} tok   ` +
    `(name:${nameChars} title:${titleChars} desc:${descChars} schema:${schemaChars})`);
}

console.log("-".repeat(70));
console.log(`  ${"TOTAL".padEnd(20)} ~${String(total).padStart(4)} tok / ${BUDGET} budget`);
console.log("");

if (total > BUDGET) {
  console.error(`FAIL: Token budget exceeded: ${total} > ${BUDGET}`);
  console.error(`   Trim tool descriptions or schema annotations.`);
  process.exit(1);
}

console.log(`PASS: Within budget (${BUDGET - total} tokens headroom)`);
process.exit(0);
