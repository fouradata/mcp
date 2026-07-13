import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { proxy } from "../../helpers/schemas.mjs";

const FIX = path.resolve(fileURLToPath(import.meta.url), "../../../helpers/fixtures");
const load = (name) => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));

const S = proxy.outputSchema;

describe("proxy outputSchema - fixture parity", () => {
  test("1. proxy-200 (success) validates", () => {
    const r = S.safeParse(load("proxy-200.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("2. proxy-200 has Set-Cookie array in response headers (regression)", () => {
    const f = load("proxy-200.json");
    const setCookie = f.headers[0]["set-cookie"];
    assert.ok(Array.isArray(setCookie));
    assert.equal(S.safeParse(f).success, true);
  });

  test("3. proxy-200 total is float (NOT integer attempt count)", () => {
    const f = load("proxy-200.json");
    assert.ok(typeof f.total === "number");
    assert.ok(f.total - Math.floor(f.total) > 0 || f.total < 1, "total should be float seconds, not integer");
  });

  test("4. proxy-200 proxy field is encoded string (base36)", () => {
    const f = load("proxy-200.json");
    assert.ok(typeof f.proxy === "string" && f.proxy.length > 0);
    assert.match(f.proxy, /^[0-9A-Z]+$/i);
  });

  test("5. proxy-200-all-fail-but-body shape validates (PrResponseError)", () => {
    // regression anchor - schema must accept this shape. Handler flags as error.
    const r = S.safeParse(load("proxy-200-all-fail-but-body.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("6. PrResponseError has NO status/headers/data - schema fields all optional", () => {
    const r = S.safeParse({ error: "all proxies failed", request: {}, total: 5.2 });
    assert.equal(r.success, true);
    assert.equal(r.data?.status, undefined);
    assert.equal(r.data?.headers, undefined);
    assert.equal(r.data?.data, undefined);
  });

  test("7. error-401 envelope validates", () => {
    const r = S.safeParse({ ...load("error-401.json"), service: "proxy" });
    assert.equal(r.success, true);
  });

  test("8. error-429 envelope validates", () => {
    const r = S.safeParse({ ...load("error-429.json"), service: "proxy" });
    assert.equal(r.success, true);
  });

  test("9. error-503-at-capacity validates", () => {
    const r = S.safeParse({ ...load("error-503-at-capacity.json"), service: "proxy" });
    assert.equal(r.success, true);
  });

  test("10. proxyId optional, accepted when present", () => {
    const r = S.safeParse({ status: 200, proxy: "4DZ3VE", proxyId: 1234, total: 0.5 });
    assert.equal(r.success, true);
  });

  test("11. total=0 boundary OK", () => {
    const r = S.safeParse({ proxy: "x", total: 0, status: 200 });
    assert.equal(r.success, true);
  });

  test("12. unknown future field accepted", () => {
    const r = S.safeParse({ proxy: "x", total: 1, status: 200, new_field: "x" });
    assert.equal(r.success, true);
  });

  test("13. service field in envelope is in the enum", () => {
    const r = S.safeParse({ service: "proxy", code: "rate_limited", error: "x" });
    assert.equal(r.success, true);
    assert.equal(S.safeParse({ service: "bogus", error: "x" }).success, false);
  });

  test("14. total_time as string OK (regression)", () => {
    const r = S.safeParse({ status: 200, proxy: "x", total: 1, total_time: "0.34" });
    assert.equal(r.success, true);
  });

  test("15. total_time as null OK (regression)", () => {
    const r = S.safeParse({ status: 200, proxy: "x", total: 1, total_time: null });
    assert.equal(r.success, true);
  });

  test("16. offload fields validate", () => {
    const r = S.safeParse({
      status: 200, proxy: "x", total: 1,
      offloaded_resource_uri: "foura-mcp://payload/abc",
      size_bytes: 99999,
    });
    assert.equal(r.success, true);
  });

  test("17. response headers accept multi-value fields", () => {
    const r = proxy.responseHeadersSchema.safeParse({
      result: { code: 200 },
      "set-cookie": ["a=1", "b=2"],
      link: ["<x>; rel=next", "<y>; rel=prev"],
    });
    assert.equal(r.success, true);
  });

  test("18. backend_status field is accepted in a 503 envelope", () => {
    const r = S.safeParse({
      error: "Backend service unavailable",
      backend_status: 503,
      detail: "x",
    });
    assert.equal(r.success, true);
  });

  test("19. scoped success accepts exitCountry", () => {
    const r = S.safeParse({ status: 200, proxy: "4DZ3VE", exitCountry: "CZ", total: 0.5 });
    assert.equal(r.success, true);
    assert.equal(r.data?.exitCountry, "CZ");
    assert.equal(S.safeParse({ status: 200, exitCountry: "USA" }).success, false);
  });

  test("20. country-scope structured errors validate", () => {
    const result = S.safeParse({
      service: "proxy",
      code: "no_eligible_proxy",
      error: "country scope failed",
      details: { exitCountries: ["CZ"] },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data?.details?.exitCountries, ["CZ"]);
    assert.equal(S.safeParse({
      code: "no_eligible_proxy",
      details: { exitCountries: ["USA"] },
    }).success, false);
  });
});
