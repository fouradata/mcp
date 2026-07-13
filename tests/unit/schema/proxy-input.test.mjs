import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { proxy } from "../../helpers/schemas.mjs";

const S = proxy.inputSchema;

describe("proxy inputSchema", () => {
  test("1. minimal valid with nested request", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" } }).success, true);
  });

  test("2. flat shape (without request wrapper) fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com" }).success, false);
  });

  test("3. missing inner method fails", () => {
    assert.equal(S.safeParse({ request: { url: "https://example.com" } }).success, false);
  });

  test("4. missing inner url fails", () => {
    assert.equal(S.safeParse({ request: { method: "GET" } }).success, false);
  });

  test("5. maxTries=0 fails (min(1))", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, maxTries: 0 }).success, false);
  });

  test("6. maxTries=1 OK", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, maxTries: 1 }).success, true);
  });

  test("7. maxTries=90 OK (boundary)", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, maxTries: 90 }).success, true);
  });

  test("8. maxTries=91 fails", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, maxTries: 91 }).success, false);
  });

  test("9. timeout_ms=0 fails (.positive() in upstream)", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, timeout_ms: 0 }).success, false);
  });

  test("10. timeout_ms=1 OK (minimum positive)", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, timeout_ms: 1 }).success, true);
  });

  test("11. timeout_ms=120000 OK", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, timeout_ms: 120000 }).success, true);
  });

  test("12. timeout_ms=120001 fails", () => {
    assert.equal(S.safeParse({ request: { method: "GET", url: "https://example.com" }, timeout_ms: 120001 }).success, false);
  });

  test("13. ignoreProxies as base36 strings OK", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      ignoreProxies: ["4DZ3VE", "ABC123"],
    }).success, true);
  });

  test("14. ignoreProxies as URLs OK (gateway accepts both)", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      ignoreProxies: ["http://1.2.3.4:8080", "socks5://5.6.7.8:1080"],
    }).success, true);
  });

  test("15. ignoreProxies with non-string fails", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      ignoreProxies: [42],
    }).success, false);
  });

  test("16. inner headers tuple form OK", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com", headers: [["X-Foo", "bar"]] },
    }).success, true);
  });

  test("17. inner headers object form fails", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com", headers: { "X-Foo": "bar" } },
    }).success, false);
  });

  test("18. inner unblocker boolean OK", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com", unblocker: true },
    }).success, true);
  });

  test("19. inner validate full shape OK", () => {
    assert.equal(S.safeParse({
      request: {
        method: "GET",
        url: "https://example.com",
        validate: { status: { accept: [200] }, data: { fail: ["captcha"] } },
      },
    }).success, true);
  });

  test("20. inner method PROPFIND (regression - z.string())", () => {
    assert.equal(S.safeParse({
      request: { method: "PROPFIND", url: "https://example.com" },
    }).success, true);
  });

  test("21. offload_large OK", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      offload_large: true,
    }).success, true);
  });

  test("22. inner data string OK", () => {
    assert.equal(S.safeParse({
      request: { method: "POST", url: "https://example.com", data: "x" },
    }).success, true);
  });

  test("23. exitCountries normalizes case, whitespace, and duplicates", () => {
    const r = S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      exitCountries: [" cz ", "GB", "CZ"],
    });
    assert.equal(r.success, true);
    assert.deepEqual(r.data?.exitCountries, ["CZ", "GB"]);
  });

  test("24. exitCountries accepts provider code XK", () => {
    assert.equal(S.safeParse({
      request: { method: "GET", url: "https://example.com" },
      exitCountries: ["XK"],
    }).success, true);
  });

  test("25. exitCountries rejects empty and malformed values", () => {
    for (const exitCountries of [[], ["USA"], ["1A"], ["C"]]) {
      assert.equal(S.safeParse({
        request: { method: "GET", url: "https://example.com" },
        exitCountries,
      }).success, false);
    }
  });
});
