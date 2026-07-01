import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { browser } from "../../helpers/schemas.mjs";

const FIX = path.resolve(fileURLToPath(import.meta.url), "../../../helpers/fixtures");
const load = (name) => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));

const S = browser.outputSchema;

describe("browser outputSchema — fixture parity", () => {
  test("1. browser-200-small validates", () => {
    const r = S.safeParse(load("browser-200-small.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("2. browser-200-small headers is Record (NOT array)", () => {
    const f = load("browser-200-small.json");
    assert.equal(Array.isArray(f.headers), false);
    assert.equal(typeof f.headers, "object");
  });

  test("3. browser-200-cdp-cookies validates (full CDP cookie shape)", () => {
    const r = S.safeParse(load("browser-200-cdp-cookies.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("4. CDP cookies allow extra fields (priority, sameParty, sourcePort)", () => {
    const r = browser.cdpCookieSchema.safeParse({
      name: "a",
      value: "1",
      domain: "x.com",
      priority: "Medium",
      sameParty: false,
      sourceScheme: "Secure",
      sourcePort: 443,
    });
    assert.equal(r.success, true);
  });

  test("5. sameSite arbitrary strings allowed (Strict/Lax/None/no_restriction)", () => {
    for (const sameSite of ["Strict", "Lax", "None", "no_restriction"]) {
      const r = browser.cdpCookieSchema.safeParse({ name: "a", value: "1", sameSite });
      assert.equal(r.success, true, `failed for sameSite=${sameSite}`);
    }
  });

  test("6. browser-200-body-object validates (regression — body can be object)", () => {
    const f = load("browser-200-body-object.json");
    assert.equal(typeof f.body, "object");
    assert.equal(Array.isArray(f.body), false);
    const r = S.safeParse(f);
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("7. body as string OK", () => {
    const r = S.safeParse({ status: 200, body: "<html>...</html>" });
    assert.equal(r.success, true);
  });

  test("8. browser-200-with-error-body schema-validates (handler flags as error)", () => {
    // regression — schema accepts this shape; handler converts to envelope.
    const r = S.safeParse(load("browser-200-with-error-body.json"));
    assert.equal(r.success, true);
  });

  test("9. error-401 envelope (service=browser)", () => {
    const r = S.safeParse({ ...load("error-401.json"), service: "browser" });
    assert.equal(r.success, true);
  });

  test("10. headers permissive — non-string values allowed (regression)", () => {
    // CDP Protocol.Network.Headers values can be arrays in some versions.
    const r = S.safeParse({
      status: 200,
      headers: { "content-type": "text/html", "set-cookie": ["a=1", "b=2"] },
      body: "<html/>",
    });
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("11. status as int OK", () => {
    const r = S.safeParse({ status: 404, body: "Not Found" });
    assert.equal(r.success, true);
  });

  test("12. userAgent string OK", () => {
    const r = S.safeParse({ status: 200, userAgent: "x", body: "y" });
    assert.equal(r.success, true);
  });

  test("13. offload fields (resource_link path)", () => {
    const r = S.safeParse({
      status: 200,
      offloaded_resource_uri: "foura-mcp://payload/xyz",
      size_bytes: 200_000,
    });
    assert.equal(r.success, true);
  });

  test("14. cookies absent OK", () => {
    const r = S.safeParse({ status: 200, body: "x" });
    assert.equal(r.success, true);
  });

  test("15. code in stable envelope set", () => {
    for (const code of ["ssrf_blocked", "auth_failed", "rate_limited", "output_validation_failed"]) {
      const r = S.safeParse({ service: "browser", code, error: "x" });
      assert.equal(r.success, true, `failed for code=${code}`);
    }
  });

  test("16. cookies with full CDP shape from fixture", () => {
    const cookies = load("browser-200-cdp-cookies.json").cookies;
    for (const c of cookies) {
      const r = browser.cdpCookieSchema.safeParse(c);
      assert.equal(r.success, true, `cookie ${c.name} failed`);
    }
  });
});
