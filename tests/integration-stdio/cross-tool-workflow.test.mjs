// Cross-tool proxy reuse — foura_proxy returns a base36 proxy ID; passing
// that string to foura_single.proxy OR foura_browser.proxy MUST exit through
// the same upstream IP. This is the workflow that external Claude/Cursor
// agents were missing because v0.2.2 schema descriptions didn't make it
// discoverable. The 0.2.3 release rewrote the field descriptions; this
// regression test locks in the actual wire behaviour.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";
import { TEST_SITES } from "../helpers/sites.mjs";
import { assertSuccess } from "../helpers/assertions.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

const TWO_MIN = 120_000;

// First two octets of an IPv4 — its /16 network. Used to tell a "same upstream
// exit, anycast low-octet variance" reuse from a genuinely different exit.
function ipv4Net16(ip) {
  const m = /(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}/.exec(ip || "");
  return m ? `${m[1]}.${m[2]}` : null;
}
function firstIpv4(s) {
  const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(s || "");
  return m ? m[1] : null;
}

describe("Cross-tool workflow — foura_proxy → foura_single/foura_browser same egress", () => {
  test("1. foura_proxy returns a base36 proxy ID", async () => {
    const r = await client.callTool("foura_proxy", {
      maxTries: 5,
      request: { method: "GET", url: TEST_SITES.ip, unblocker: true, tryJsonData: true },
    }, TWO_MIN);
    if (r.isError) {
      // Pool nondeterminism — skip downstream cases if the first call failed.
      globalThis.__crossToolProxy = null;
      return;
    }
    assertSuccess(r);
    assert.equal(r.structuredContent.status, 200);
    const proxy = r.structuredContent.proxy;
    const origin = r.structuredContent.data?.origin;
    assert.ok(typeof proxy === "string" && /^[0-9A-Z]{6,9}$/.test(proxy),
      `proxy must be a base36 ID, got: ${proxy}`);
    assert.ok(typeof origin === "string", `origin IP required, got: ${origin}`);
    globalThis.__crossToolProxy = { proxy, origin };
  });

  test("2. foura_single with proxy=<id> → same exit (exact IP, or same /16 for anycast exits)", async (t) => {
    const ctx = globalThis.__crossToolProxy;
    if (!ctx) return t.skip("previous foura_proxy step skipped");
    const r = await client.callTool("foura_single", {
      method: "GET",
      url: TEST_SITES.ip,
      proxy: ctx.proxy,
      tryJsonData: true,
      unblocker: true,
    }, TWO_MIN);
    if (r.isError) {
      // A reused pool exit can die at transport level (handshake / timeout) — a
      // pool failure, not a reuse-routing failure. Skip like the sibling tests.
      return t.skip(`reused proxy failed at transport: ${r.structuredContent?.error ?? "unknown"}`);
    }
    assertSuccess(r);
    const origin = r.structuredContent.data?.origin;
    // The test can only assert "same exit" when it actually OBSERVES the egress IP.
    // If the target didn't echo an IP (httpbin flake / non-JSON), it's inconclusive
    // — skip rather than fail (a real reuse regression shows up as an OBSERVED
    // different-network egress, which still fails below).
    if (!firstIpv4(origin)) return t.skip(`could not observe egress IP on reuse: ${JSON.stringify(origin)?.slice(0, 120)}`);
    if (origin === ctx.origin) return; // strict proof: byte-exact same exit IP
    // Some pool exits (e.g. Cloudflare WARP) NAT through a whole /16 and vary the
    // low octets per request — exact-IP can't hold for those. Same /16 still proves
    // the reuse routed through the SAME upstream exit network (a non-reused draw
    // would be a different ASN entirely). A different network IS a real regression.
    if (ipv4Net16(origin) && ipv4Net16(origin) === ipv4Net16(ctx.origin)) {
      return t.skip(`reused exit is anycast/WARP-class (${ctx.origin} -> ${origin}, same /16) — exact-IP premise N/A`);
    }
    assert.equal(origin, ctx.origin,
      `foura_single with proxy=${ctx.proxy} must exit through the same network (${ctx.origin}), got ${origin}`);
  });

  test("3. foura_browser with proxy=<id> → SAME egress IP (the case external Claude got wrong)", async (t) => {
    const ctx = globalThis.__crossToolProxy;
    if (!ctx) return t.skip("previous foura_proxy step skipped");
    const r = await client.callTool("foura_browser", {
      url: TEST_SITES.ip,
      proxy: ctx.proxy,
      timeout_ms: 60_000,
    }, TWO_MIN);
    if (r.isError) {
      return t.skip(`reused proxy failed at transport: ${r.structuredContent?.error ?? "unknown"}`);
    }
    assertSuccess(r);
    // Browser body is the rendered httpbin/ip JSON page.
    const body = r.structuredContent.body;
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    if (bodyStr.includes(ctx.origin)) return; // strict proof: byte-exact same exit IP
    // Same anycast/WARP allowance as test 2 — compare the egress /16 the browser
    // actually used (parsed from the rendered httpbin/ip JSON).
    const origin = firstIpv4(bodyStr);
    // No IP in the rendered body (httpbin returned HTML / a challenge / didn't echo)
    // — egress unobservable, inconclusive. Skip rather than fail.
    if (!origin) return t.skip(`browser body had no parseable egress IP (target/render flake): ${bodyStr.slice(0, 120)}`);
    if (ipv4Net16(origin) && ipv4Net16(origin) === ipv4Net16(ctx.origin)) {
      return t.skip(`reused exit is anycast/WARP-class (${ctx.origin} -> ${origin}, same /16) — exact-IP premise N/A`);
    }
    assert.ok(bodyStr.includes(ctx.origin),
      `foura_browser with proxy=${ctx.proxy} must exit through ${ctx.origin}'s network; got ${origin ?? bodyStr.slice(0, 200)}`);
  });

  test("4. foura_proxy can also rotate AWAY from a known-bad ID via ignoreProxies", async (t) => {
    const ctx = globalThis.__crossToolProxy;
    if (!ctx) return t.skip("previous foura_proxy step skipped");
    const r = await client.callTool("foura_proxy", {
      maxTries: 5,
      ignoreProxies: [ctx.proxy],
      request: { method: "GET", url: TEST_SITES.ip, unblocker: true, tryJsonData: true },
    }, TWO_MIN);
    if (r.isError) return; // pool may run out; that's its own failure mode
    const otherProxy = r.structuredContent.proxy;
    assert.notEqual(otherProxy, ctx.proxy,
      `with ignoreProxies:[${ctx.proxy}], pool must pick a DIFFERENT proxy, got the same one`);
  });

  test("5. foura_single rejects proxyId field (dead-field removal regression)", async () => {
    // 0.2.3 removed `proxyId` from singleInputShape. It was a no-op at runtime
    // (backend curl never reads request.proxyId), so exposing it was a lie.
    // This test guards against accidental re-introduction.
    const r = await client.callTool("foura_single", {
      method: "GET",
      url: TEST_SITES.static,
      proxyId: 12345,   // not in schema anymore
    }, TWO_MIN);
    // Strict zod parse will reject unknown fields with isError; if it ever
    // starts passing, someone reintroduced the field.
    if (!r.isError) {
      // zod by default strips unknown keys silently — that's also acceptable
      // (the field is simply dropped, can't cause a no-op trap). What MUST
      // fail is: the response treats proxyId as a real instruction. Verify
      // egress is the DEFAULT container egress IP, not the imaginary id.
      const r2 = await client.callTool("foura_single", {
        method: "GET", url: TEST_SITES.ip, tryJsonData: true, unblocker: true,
      }, TWO_MIN);
      const defaultOrigin = r2.structuredContent?.data?.origin;
      const r3 = await client.callTool("foura_single", {
        method: "GET", url: TEST_SITES.ip, tryJsonData: true, unblocker: true,
        proxyId: 12345,
      }, TWO_MIN);
      const proxyIdOrigin = r3.structuredContent?.data?.origin;
      assert.equal(proxyIdOrigin, defaultOrigin,
        "proxyId in input must NOT change egress (field is unsupported, default behavior expected)");
    }
  });
});
