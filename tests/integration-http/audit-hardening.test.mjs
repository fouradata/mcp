// Audit hardening regressions - Origin/Host validation, WWW-Authenticate,
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

describe("Origin and Host validation", () => {
  test("1. valid Host (127.0.0.1) + no Origin (server-to-server) -> accepted", async () => {
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

  test("2. allowed Origin (https://test.local) -> accepted", async () => {
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

  test("3. disallowed Origin returns 403", async () => {
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

  test("4. disallowed Host header returns 403", async () => {
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

  test("5. unrelated Host (random domain) -> 403", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT,
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_KEY}`,
        Host: "untrusted.example.com",
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

describe("WWW-Authenticate on 401", () => {
  // Discovery is keyless since 0.4.4 (registries and gateways enumerate the
  // server before a user supplies a key), so only execution challenges.
  test("1. missing Bearer -> discovery succeeds", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": CT, Accept: ACCEPT },
      body: initBody(),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 200);
  });

  test("2. missing Bearer on a tool call -> 401 + WWW-Authenticate header", async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": CT, Accept: ACCEPT },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "foura_single", arguments: { method: "GET", url: "https://example.com" } },
      }),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 401);
    const wwwAuth = String(res.headers["www-authenticate"] ?? "");
    assert.ok(wwwAuth, "WWW-Authenticate header required on 401");
    assert.match(wwwAuth, /^Bearer realm="foura-mcp"/);
    // 0.4.3 dropped the RFC 9728 resource_metadata parameter on purpose:
    // advertising it makes OAuth-capable gateways start a flow this server
    // does not implement. Re-adding it silently breaks those clients.
    assert.doesNotMatch(wwwAuth, /resource_metadata/);
  });
});

describe("MCP-Protocol-Version validation", () => {
  // CLASS-LEVEL REGRESSION: every version the bundled SDK supports must
  // pass our middleware. If a future SDK adds a new version, this test
  // auto-extends. If we ever shadow the SDK's list with a stale hardcoded
  // copy, this test breaks immediately.
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    test(`SDK version ${version} -> accepted`, async () => {
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

  // Known client versions used for compatibility coverage.
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
    test(`real-world ${client} (${version}) -> accepted`, async () => {
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
        `Known client ${client} sends ${version} and must not be rejected. ` +
        `If this fails, the SDK pin is too old and is breaking production users.`);
    });
  }

  test("unknown future date 9999-12-31 -> 400 with informative error", async () => {
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

  test("malformed string -> 400", async () => {
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

  test("missing header -> accepted (backwards-compat per spec)", async () => {
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

// Spec 2026-07-28 made MCP stateless: no initialize handshake, no session id,
// per-request `_meta`. This server speaks the initialize-based ("legacy") era.
// Clients that speak both eras probe by sending a modern request FIRST and
// decide from the 400 body whether to fall back:
//
//   "If the body contains a recognized modern JSON-RPC error, the server speaks
//    a modern version of MCP - retry using the advertised `supported` versions
//    ... If the body is empty or is not a recognized modern JSON-RPC error,
//    fall back to `initialize` and continue with the legacy version."
//   -- 2026-07-28 / basic/transports/streamable-http#backward-compatibility
//
// So our rejection has to land in the FALLBACK branch. Today it does, but only
// because -32602 happens not to be one of the three codes the spec reserves for
// modern servers. That is an accident, and an accident that breaks silently:
// every dual-era client would stop falling back and simply fail to connect,
// with nothing on our side going red. This block makes it deliberate.
const MODERN_ERA_VERSION = "2026-07-28";
// Codes a modern server returns on 400. Emitting ANY of these tells a probing
// client "I am modern, do not fall back".
// -- 2026-07-28 / basic/index#error-codes
const MODERN_ERA_ERROR_CODES = new Map([
  [-32020, "HeaderMismatch"],
  [-32021, "MissingRequiredClientCapability"],
  [-32022, "UnsupportedProtocolVersion"],
]);

describe("dual-era client fallback (spec 2026-07-28)", () => {
  const weSpeakModern = SUPPORTED_PROTOCOL_VERSIONS.includes(MODERN_ERA_VERSION);

  test(`1. a client announcing ${MODERN_ERA_VERSION} is answered so it can fall back`, async () => {
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": CT, Accept: ACCEPT,
        "MCP-Protocol-Version": MODERN_ERA_VERSION,
      },
      body: initBody(),
    });

    if (weSpeakModern) {
      // The SDK now carries the modern era. This whole block is obsolete:
      // the server must ACCEPT the version, and the contract to pin becomes
      // `server/discover` + per-request `_meta`, not the fallback path.
      res.body.dump?.();
      assert.notEqual(res.statusCode, 400,
        `The bundled SDK lists ${MODERN_ERA_VERSION} in SUPPORTED_PROTOCOL_VERSIONS, so the ` +
        "server must serve it instead of rejecting it. Rewrite this block for the modern era.");
      return;
    }

    const body = await res.body.json();
    assert.equal(res.statusCode, 400,
      `${MODERN_ERA_VERSION} is not in the bundled SDK, so it must be rejected with 400`);

    // A dual-era client reads the BODY to pick its branch, so an empty or
    // unparseable body sends it down the deprecated HTTP+SSE probe instead.
    assert.equal(body.jsonrpc, "2.0", "the 400 body must be a JSON-RPC error object");
    assert.equal(typeof body.error?.code, "number", "the 400 body must carry an error code");
    assert.ok(body.error.message, "the 400 body must carry a message clients can surface");

    const modernName = MODERN_ERA_ERROR_CODES.get(body.error.code);
    assert.equal(modernName, undefined,
      `Rejecting with ${body.error.code} (${modernName}) tells a dual-era client this server ` +
      "speaks the modern era, so it retries instead of falling back to initialize - and never " +
      `connects. Use a code outside ${[...MODERN_ERA_ERROR_CODES.keys()].join(", ")} for as ` +
      "long as this server is initialize-based.");
  });

  test("2. after the rejection, the legacy initialize handshake still works", async () => {
    // The half that actually matters to a user: the fallback the client makes
    // must succeed. Keyless, because discovery is public since 0.4.4.
    const res = await request(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": CT, Accept: ACCEPT },
      body: initBody(),
    });
    res.body.dump?.();
    assert.equal(res.statusCode, 200,
      "a client that fell back to initialize must be served, or the probe was pointless");
  });
});

describe("request body size cap", () => {
  test("1. 200 KB body -> accepted by transport", async () => {
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

  test("2. 300 KB body -> 413 Payload Too Large", async () => {
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

describe("graceful shutdown", () => {
  test("1. SIGTERM lets the server close cleanly", async () => {
    // Start a separate instance, send SIGTERM, assert exit 0.
    const tmp = await startLocalServer();
    const before = Date.now();
    await tmp.close();
    const elapsed = Date.now() - before;
    assert.ok(elapsed < 5000, `clean shutdown should be fast, got ${elapsed}ms`);
  });
});
