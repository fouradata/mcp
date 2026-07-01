#!/usr/bin/env node
// End-to-end smoke — initialize + tools/list + tools/call against live FourA API.
// Run: FOURA_API_KEY=pk_live_... node tests/smoke.mjs

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn("npx", ["tsx", "src/stdio.ts"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

const rl = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("non-JSON line:", line);
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function send(method, params, timeoutMs = 60_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout for ${method}`));
      }
    }, timeoutMs);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function call(name, args, timeoutMs) {
  const resp = await send("tools/call", { name, arguments: args }, timeoutMs);
  if (resp.error) return { isError: true, text: JSON.stringify(resp.error) };
  return {
    isError: resp.result?.isError === true,
    // content[0].text is the human-readable summary ("200 OK · 1.2 KB · 0.4s");
    // the parsed response lives in structuredContent (the typed outputSchema).
    text: resp.result?.content?.[0]?.text ?? "",
    structuredContent: resp.result?.structuredContent ?? {},
  };
}

let failed = 0;
function assert(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("\n[1] initialize");
  const initResp = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  assert("server name", initResp.result?.serverInfo?.name === "foura-mcp");
  assert("protocol version", initResp.result?.protocolVersion === "2025-03-26");
  notify("notifications/initialized");

  console.log("\n[2] tools/list");
  const listResp = await send("tools/list", {});
  const tools = listResp.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  assert(`4 tools registered (got ${names.length}: ${names.join(", ")})`, names.length === 4);
  assert("foura_auto present", names.includes("foura_auto"));
  assert("foura_single present", names.includes("foura_single"));
  assert("foura_proxy present", names.includes("foura_proxy"));
  assert("foura_browser present", names.includes("foura_browser"));

  console.log("\n[3] tools/call foura_single → httpbin.org/headers");
  const single = await call(
    "foura_single",
    { method: "GET", url: "https://httpbin.org/headers", unblocker: true },
    30_000,
  );
  if (single.isError) {
    console.log(`  ✗ tool error: ${single.text.slice(0, 200)}`);
    failed++;
  } else {
    const parsed = single.structuredContent;
    assert(`status 200 (got ${parsed.status})`, parsed.status === 200);
    assert("total_time present", typeof parsed.total_time === "number");
    assert("data contains httpbin", String(parsed.data).includes("httpbin"));
  }

  console.log("\n[4] tools/call foura_proxy → httpbin.org/ip (maxTries:2)");
  const proxy = await call(
    "foura_proxy",
    { maxTries: 2, request: { method: "GET", url: "https://httpbin.org/ip", unblocker: true } },
    60_000,
  );
  if (proxy.isError) {
    console.log(`  ✗ tool error: ${proxy.text.slice(0, 200)}`);
    failed++;
  } else {
    const parsed = proxy.structuredContent;
    assert(`status 200 (got ${parsed.status})`, parsed.status === 200);
    assert(`proxy id returned (got "${parsed.proxy}")`, typeof parsed.proxy === "string" && parsed.proxy.length > 0);
    assert("total attempts field present", typeof parsed.total === "number");
  }

  console.log("\n[5] tools/call foura_browser → example.com (timeout 20s)");
  const browser = await call(
    "foura_browser",
    { url: "https://example.com", timeout_ms: 20_000 },
    60_000,
  );
  if (browser.isError) {
    console.log(`  ✗ tool error: ${browser.text.slice(0, 200)}`);
    failed++;
  } else {
    const parsed = browser.structuredContent;
    assert(`status 200 (got ${parsed.status})`, parsed.status === 200);
    assert("body contains <html", String(parsed.body ?? "").toLowerCase().includes("<html"));
    assert("userAgent present", typeof parsed.userAgent === "string");
  }

  console.log("\n[6] error path — invalid url should reject at validation");
  const bad = await call("foura_single", { method: "GET", url: "not-a-url" });
  assert("validation error returned", bad.isError, bad.text.slice(0, 200));

  child.kill();
  if (failed > 0) {
    console.log(`\n❌ ${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\n✅ all assertions passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  child.kill();
  process.exit(1);
});
