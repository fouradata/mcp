import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { browser } from "../../helpers/schemas.mjs";

const S = browser.inputSchema;

describe("browser inputSchema", () => {
  test("1. minimal valid", () => {
    assert.equal(S.safeParse({ url: "https://example.com" }).success, true);
  });

  test("2. missing url fails", () => {
    assert.equal(S.safeParse({}).success, false);
  });

  test("3. empty url fails", () => {
    assert.equal(S.safeParse({ url: "" }).success, false);
  });

  test("4. invalid url fails", () => {
    assert.equal(S.safeParse({ url: "not-a-url" }).success, false);
  });

  test("5. headers object form OK (browser uses Record)", () => {
    assert.equal(S.safeParse({ url: "https://example.com", headers: { "X-Foo": "bar" } }).success, true);
  });

  test("6. headers tuple form fails (browser != single/proxy)", () => {
    assert.equal(S.safeParse({ url: "https://example.com", headers: [["X-Foo", "bar"]] }).success, false);
  });

  test("7. cookies array with name+value OK", () => {
    assert.equal(S.safeParse({
      url: "https://example.com",
      cookies: [{ name: "s", value: "a" }],
    }).success, true);
  });

  test("8. cookies with domain OK", () => {
    assert.equal(S.safeParse({
      url: "https://example.com",
      cookies: [{ name: "s", value: "a", domain: ".example.com" }],
    }).success, true);
  });

  test("9. cookies missing name fails", () => {
    assert.equal(S.safeParse({
      url: "https://example.com",
      cookies: [{ value: "a" }],
    }).success, false);
  });

  test("10. cookies missing value fails", () => {
    assert.equal(S.safeParse({
      url: "https://example.com",
      cookies: [{ name: "s" }],
    }).success, false);
  });

  test("11. userAgent string OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", userAgent: "Mozilla/5.0" }).success, true);
  });

  test("12. proxy URL OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", proxy: "socks5://1.2.3.4:1080" }).success, true);
  });

  test("13. timeout_ms=0 OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", timeout_ms: 0 }).success, true);
  });

  test("14. timeout_ms=120000 OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", timeout_ms: 120000 }).success, true);
  });

  test("15. timeout_ms=120001 fails", () => {
    assert.equal(S.safeParse({ url: "https://example.com", timeout_ms: 120001 }).success, false);
  });

  test("16. checkStatus OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", checkStatus: 200 }).success, true);
  });

  test("17. checkText OK", () => {
    assert.equal(S.safeParse({ url: "https://example.com", checkText: "add to cart" }).success, true);
  });

  test("18. offload_large boolean OK (regression)", () => {
    assert.equal(S.safeParse({ url: "https://example.com", offload_large: true }).success, true);
  });
});
