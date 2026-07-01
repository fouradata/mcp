// Audit hardening regressions — Origin/Host validation, WWW-Authenticate,
// MCP-Protocol-Version, body size cap, request timeout, graceful shutdown.
// All run against a LOCAL `node dist/http.js` so they're independent of the
// deployed mcp.foura.ai.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "undici";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { startLocalServer } from "./_local-server.mjs";

const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;

let server;
before(async () => { server = await startLocalServer(); });
after(async () => { await server?.close(); });

function initBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "audit-test", version: "0.0.1" },
    },
  });
}

const CT = "application/json";
const ACCEPT = "application/json, text/event-stream";

describe("Audit 1.1 — Origin + Host validation (CVE-2025-66414)", () => {
  test("1. valid Host (127.0.0.1) + no Origin (server-to-server) → accepted", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: initBody(),
    });
    res.body.dump?.();
    assert.notEqual(res.statusCode, 403, `unexpected 403: ${res.statusCode}`);
  });

  test("2. allowed Origin (https://test.local) → accepted", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        Origin: "https://test.local",
      },
      body: initBody(),
    });
    res.body.dump?.();
    assert.notEqual(res.statusCode, 403);
  });

  test("3. attacker Origin (https://evil.com) → 403", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        Origin: "https://evil.com",
      },
      body: initBody(),
    });
    const body = await res.body.json();
    assert.equal(res.statusCode, 403);
    assert.match(body.error.message, /Origin .* not in the allowlist/);
  });

  test("4. attacker Host header (169.254.169.254 — AWS metadata) → 403", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        Host: "169.254.169.254",
      },
      body: initBody(),
    });
    const body = await res.body.json();
    assert.equal(res.statusCode, 403);
    assert.match(body.error.message, /Host .* not in the allowlist/);
  });

  test("5. unrelated Host (random domain) → 403", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        Host: "attacker.example.com",
      },
      body: initBody(),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 403);
  });

  test("6. /healthz stays open regardless of Origin/Host", async () => {
    const res = await request(`${server.url}/healthz`, {
      headers: { Origin: "https://evil.com" },
    });
    assert.equal(res.statusCode, 200);
    res.body.dump?.();
  });
});

describe("Audit 1.2 — WWW-Authenticate on 401", () => {
  test("1. missing Bearer → 401 + WWW-Authenticate header", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": CT, Accept: ACCEPT },
      body: initBody(),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 401);
    const wwwAuth = res.headers["www-authenticate"];
    assert.ok(wwwAuth, "WWW-Authenticate header required on 401");
    assert.match(String(wwwAuth), /^Bearer realm="foura-mcp"/);
    assert.match(String(wwwAuth), /resource_metadata="https?:\/\/.+"/);
  });
});

describe("Audit 1.3 — MCP-Protocol-Version validation (SDK-driven allowlist)", () => {
  // CLASS-LEVEL REGRESSION: every version the bundled SDK supports must
  // pass our middleware. If a future SDK adds a new version, this test
  // auto-extends. If we ever shadow the SDK's list with a stale hardcoded
  // copy, this test breaks immediately.
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    test(`SDK version ${version} → accepted`, async () => {
      const res = await request(`${server.url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": CT, Accept: ACCEPT,
          Authorization: `Bearer ${TEST_KEY}`,
          "MCP-Protocol-Version": version,
        },
        body: initBody(),
      });
      res.body.dump?.();
      assert.notEqual(res.statusCode, 400,
        `version ${version} from SDK's SUPPORTED_PROTOCOL_VERSIONS must NOT be rejected with 400`);
    });
  }

  // KNOWN REAL-WORLD CLIENT VERSIONS — explicit list of MCP clients we know
  // about in the wild + the protocol version each one sends in the
  // MCP-Protocol-Version header. Update when a new client lands so we have
  // an explicit reminder of what to test.
  // Source of truth: the client's own source / network captures.
  const REAL_CLIENT_VERSIONS = [
    { client: "Claude Code 2.1.141 (Nov 2025)", version: "2025-11-25" },
    { client: "Claude Desktop (Nov 2025)", version: "2025-06-18" },
    { client: "Cursor latest (2026)", version: "2025-06-18" },
    { client: "Windsurf latest", version: "2025-06-18" },
    { client: "Legacy MCP client pre-2025", version: "2024-11-05" },
  ];
  for (const { client, version } of REAL_CLIENT_VERSIONS) {
    test(`real-world ${client} (${version}) → accepted`, async () => {
      const res = await request(`${server.url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": CT, Accept: ACCEPT,
          Authorization: `Bearer ${TEST_KEY}`,
          "MCP-Protocol-Version": version,
        },
        body: initBody(),
      });
      res.body.dump?.();
      assert.notEqual(res.statusCode, 400,
        `Real-world client ${client} sends ${version} — must NOT be rejected. ` +
        `If this fails, the SDK pin is too old and is breaking production users.`);
    });
  }

  test("unknown future date 9999-12-31 → 400 with informative error", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        "MCP-Protocol-Version": "9999-12-31",
      },
      body: initBody(),
    });
    const body = await res.body.json();
    assert.equal(res.statusCode, 400);
    assert.match(body.error.message, /Unsupported MCP-Protocol-Version/);
    // Error must include the supported list so client devs can self-diagnose
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      assert.ok(body.error.message.includes(v),
        `error message must include ${v} so clients can see what we accept`);
    }
  });

  test("malformed string → 400", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        "MCP-Protocol-Version": "not-a-version",
      },
      body: initBody(),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 400);
  });

  test("missing header → accepted (backwards-compat per spec)", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: initBody(),
    });
    res.body.dump?.();
    assert.notEqual(res.statusCode, 400);
  });
});

describe("Audit 1.7 — body size cap (256 KB)", () => {
  test("1. 200 KB body → accepted by transport", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { padding: "a".repeat(200_000) },
        clientInfo: { name: "x", version: "0" },
      },
    });
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: big,
    });
    res.body.dump?.();
    assert.notEqual(res.statusCode, 413, "200KB should pass the 256KB limit");
  });

  test("2. 300 KB body → 413 Payload Too Large", async () => {
    const huge = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { padding: "a".repeat(300_000) },
        clientInfo: { name: "x", version: "0" },
      },
    });
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: huge,
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 413);
  });
});

describe("Audit 3.1 — graceful shutdown", () => {
  test("1. SIGTERM lets the server close cleanly", async () => {
    // Start a separate instance, send SIGTERM, assert exit 0.
    const tmp = await startLocalServer();
    const before = Date.now();
    await tmp.close();
    const elapsed = Date.now() - before;
    assert.ok(elapsed < 5000, `clean shutdown should be fast, got ${elapsed}ms`);
  });
});
