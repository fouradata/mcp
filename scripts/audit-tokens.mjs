#!/usr/bin/env node
/**
 * Token-bloat audit — measure how many tokens the LLM pays per turn just to
 * "know about" our tools. MCP clients inject tools/list into the system prompt
 * on every message; this cost is paid forever until the LLM rotates context.
 *
 * Estimate: chars / 3.5 (conservative for English/JSON mix; Claude tokenizer
 * is internal — this approximation overestimates slightly, which is what we
 * want for a safety gate).
 *
 * Fails (exit 1) if total exceeds BUDGET. Use env BUDGET_TOKENS=N to override.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Token budget for the combined tool/list payload sent to clients on every
// session init. Raised 5000 → 6000 in v0.2.3 (cross-tool reuse hints), then
// 6000 → 6500 in v0.2.8 (validate.headers semantics + error-code enum), then
// 6500 → 7000 in v0.2.10 (WAF escalation discoverability — agent decision-tree
// content moved into tools/list so agents don't have to reach for docs). Real
// ceiling for "still fits without being a context tax" is around 7500; keep
// headroom.
// Raised 7000 -> 10000 in v0.3.0 for the FOURTH tool, foura_auto (the
// smart-default orchestrator, ~2.7k tok). The three primitives were KEPT in
// full -- auto is an additional entry point, not a replacement, so its cost is
// additive by design. The "context tax" ceiling for FOUR tools sits ~10500.
// Raised 10000 -> 11000 in v0.4.7: every tool input parameter now carries a
// description (MCP-registry quality signals + better agent guidance). The fuller
// input schemas cost ~560 more tokens; still a modest per-session cost for four
// fully-documented tools. Trim descriptions before raising this further.
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
console.log("─".repeat(70));

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

console.log("─".repeat(70));
console.log(`  ${"TOTAL".padEnd(20)} ~${String(total).padStart(4)} tok / ${BUDGET} budget`);
console.log("");

if (total > BUDGET) {
  console.error(`❌ Token budget exceeded: ${total} > ${BUDGET}`);
  console.error(`   Trim tool descriptions or schema annotations.`);
  process.exit(1);
}

console.log(`✓ Within budget (${BUDGET - total} tokens headroom)`);
process.exit(0);
