// JSON-RPC over stdio client for the MCP server.
// Spawns `node dist/stdio.js` so tests exercise the just-built code,
// not the published npm tarball.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY = path.join(REPO_ROOT, "dist/stdio.js");

export class StdioClient {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 1;
    this.notifications = [];

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      } else if (msg.method) {
        this.notifications.push(msg);
      }
    });

    this.exitPromise = new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  send(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.child.stdin.write(payload);
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout (${timeoutMs}ms) for ${method}`));
        }
      }, timeoutMs);
      timer.unref();
    });
  }

  notify(method, params) {
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }

  async initialize() {
    const resp = await this.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "foura-mcp-tests", version: "0.0.1" },
    });
    this.notify("notifications/initialized");
    return resp.result;
  }

  async listTools() {
    const resp = await this.send("tools/list", {});
    return resp.result?.tools ?? [];
  }

  async listPrompts() {
    const resp = await this.send("prompts/list", {});
    return resp.result?.prompts ?? [];
  }

  async getPrompt(name, args = {}) {
    const resp = await this.send("prompts/get", { name, arguments: args });
    return resp.result;
  }

  async callTool(name, args, timeoutMs = 60_000) {
    const resp = await this.send("tools/call", { name, arguments: args }, timeoutMs);
    if (resp.error) {
      return {
        isError: true,
        errorObj: resp.error,
        content: [{ type: "text", text: JSON.stringify(resp.error) }],
      };
    }
    return resp.result;
  }

  async readResource(uri) {
    const resp = await this.send("resources/read", { uri });
    return resp.result;
  }

  async close() {
    try {
      this.child.stdin.end();
    } catch {}
    this.child.kill("SIGTERM");
    await this.exitPromise;
  }
}

export async function spawnLocalServer(envOverrides = {}) {
  const env = {
    ...process.env,
    FOURA_API_KEY: process.env.FOURA_API_KEY ?? process.env.DW_TEST_API_KEY ?? "",
    ...envOverrides,
  };
  if (!env.FOURA_API_KEY) {
    throw new Error("FOURA_API_KEY (or DW_TEST_API_KEY) must be set for stdio tests");
  }
  const child = spawn("node", [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  child.stderr.on("data", (chunk) => {
    if (process.env.FOURA_TEST_VERBOSE) process.stderr.write(chunk);
  });
  const client = new StdioClient(child);
  await client.initialize();
  return client;
}
