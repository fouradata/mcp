import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { single } from "../../helpers/schemas.mjs";

const S = single.inputSchema;

describe("single inputSchema", () => {
  test("1. minimal valid input", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com" }).success, true);
  });

  test("2. missing method fails", () => {
    assert.equal(S.safeParse({ url: "https://example.com" }).success, false);
  });

  test("3. missing url fails", () => {
    assert.equal(S.safeParse({ method: "GET" }).success, false);
  });

  test("4. empty url fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "" }).success, false);
  });

  test("5. non-URL url fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "not-a-url" }).success, false);
  });

  test("6. ftp scheme allowed at zod layer (SSRF blocks later)", () => {
    assert.equal(S.safeParse({ method: "GET", url: "ftp://example.com" }).success, true);
  });

  test("7. long URL OK (no max length)", () => {
    const url = "https://" + "a".repeat(2050) + ".com";
    assert.equal(S.safeParse({ method: "GET", url }).success, true);
  });

  test("8. non-enum method accepted (regression fix)", () => {
    // The method stays open so WebDAV and CalDAV verbs work.
    assert.equal(S.safeParse({ method: "PROPFIND", url: "https://example.com" }).success, true);
    assert.equal(S.safeParse({ method: "MKCOL", url: "https://example.com" }).success, true);
    assert.equal(S.safeParse({ method: "CONNECT", url: "https://example.com" }).success, true);
  });

  test("9. wrong-type method fails", () => {
    assert.equal(S.safeParse({ method: 42, url: "https://example.com" }).success, false);
  });

  test("10. all standard methods OK", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.equal(S.safeParse({ method: m, url: "https://example.com" }).success, true, `failed for ${m}`);
    }
  });

  test("11. timeout_ms=0 OK", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", timeout_ms: 0 }).success, true);
  });

  test("12. timeout_ms=120000 OK", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", timeout_ms: 120000 }).success, true);
  });

  test("13. timeout_ms=120001 fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", timeout_ms: 120001 }).success, false);
  });

  test("14. timeout_ms=-1 fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", timeout_ms: -1 }).success, false);
  });

  test("15. timeout_ms=1.5 fails (int required)", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", timeout_ms: 1.5 }).success, false);
  });

  test("16. followRedirects=0 OK", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", followRedirects: 0 }).success, true);
  });

  test("17. followRedirects=20 OK (boundary)", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", followRedirects: 20 }).success, true);
  });

  test("18. followRedirects=21 fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", followRedirects: 21 }).success, false);
  });

  test("19. unblocker as string fails", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", unblocker: "yes" }).success, false);
  });

  test("20. headers tuple form OK", () => {
    assert.equal(S.safeParse({
      method: "GET", url: "https://example.com",
      headers: [["Accept", "*/*"], ["X-Foo", "bar"]],
    }).success, true);
  });

  test("21. headers object form fails (single uses tuples)", () => {
    assert.equal(S.safeParse({
      method: "GET", url: "https://example.com",
      headers: { "Accept": "*/*" },
    }).success, false);
  });

  test("22. headers 1-tuple fails", () => {
    assert.equal(S.safeParse({
      method: "GET", url: "https://example.com",
      headers: [["Accept"]],
    }).success, false);
  });

  test("23. data string OK", () => {
    assert.equal(S.safeParse({ method: "POST", url: "https://example.com", data: "raw body" }).success, true);
  });

  test("24. data object OK", () => {
    assert.equal(S.safeParse({ method: "POST", url: "https://example.com", data: { foo: 1 } }).success, true);
  });

  test("25. data array fails (not string/object)", () => {
    assert.equal(S.safeParse({ method: "POST", url: "https://example.com", data: ["x"] }).success, false);
  });

  test("26. full validate object OK", () => {
    assert.equal(S.safeParse({
      method: "GET", url: "https://example.com",
      validate: { status: { accept: [200] }, data: { fail: ["captcha"] } },
    }).success, true);
  });

  test("27. offload_large boolean OK (regression fix field)", () => {
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", offload_large: true }).success, true);
    assert.equal(S.safeParse({ method: "GET", url: "https://example.com", offload_large: false }).success, true);
  });
});
