// Spawn `node dist/http.js` on a random port for HTTP-transport tests that
// need to assert behavior of the LOCAL build (e.g. audit hardening pre-deploy).
// Production tests still hit mcp.foura.ai via FOURA_MCP_HTTP_URL.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function startLocalServer({ env: envOverrides = {} } = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    FOURA_MCP_ALLOWED_HOSTS: "127.0.0.1,localhost,[::1]",
    FOURA_MCP_ALLOWED_ORIGINS: "https://test.local",
    ...envOverrides,
  };
  const child = spawn("node", ["dist/http.js"], {
    cwd: new URL("../../", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  let ready = false;
  child.stderr.on("data", (chunk) => {
    if (chunk.toString().includes(`HTTP listening on :${port}`)) ready = true;
    if (process.env.FOURA_TEST_VERBOSE) process.stderr.write(chunk);
  });
  for (let i = 0; i < 50; i++) {
    if (ready) break;
    await delay(100);
  }
  if (!ready) {
    child.kill();
    throw new Error("local http.js did not become ready");
  }
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => {
      child.once("exit", () => r());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }),
  };
}
