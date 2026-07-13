import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { single } from "../../helpers/schemas.mjs";

const FIX = path.resolve(fileURLToPath(import.meta.url), "../../../helpers/fixtures");
const load = (name) => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));

const S = single.outputSchema;

describe("single outputSchema - fixture parity", () => {
  test("1. single-200-simple validates", () => {
    const r = S.safeParse(load("single-200-simple.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("2. single-200-cookies (Set-Cookie as ARRAY - regression anchor) validates", () => {
    const fixture = load("single-200-cookies.json");
    const setCookie = fixture.headers[0]["set-cookie"];
    assert.ok(Array.isArray(setCookie) && setCookie.length === 2, "fixture itself must have array Set-Cookie");
    const r = S.safeParse(fixture);
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("3. single-200-redirect-chain (header array length > 1) validates", () => {
    const fixture = load("single-200-redirect-chain.json");
    assert.ok(fixture.headers.length >= 2);
    const r = S.safeParse(fixture);
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("4. single-200-json-data (data=object, tryJsonData branch) validates", () => {
    const r = S.safeParse(load("single-200-json-data.json"));
    assert.equal(r.success, true);
  });

  test("5. single-200-total-time-string (regression - total_time as string) validates", () => {
    const r = S.safeParse(load("single-200-total-time-string.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("6. single-200-total-time-null (regression - total_time=null) validates", () => {
    const r = S.safeParse(load("single-200-total-time-null.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("7. single-200-with-error-body (regression - 2xx-with-error) parses raw shape", () => {
    // The schema accepts this shape (error field is optional); the BUG fix is
    // in the handler code path that flags it as an error envelope, tested in
    // integration-stdio/errors.test.mjs.
    const r = S.safeParse(load("single-200-with-error-body.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("8. error-401 envelope validates", () => {
    const r = S.safeParse(load("error-401.json"));
    assert.equal(r.success, true);
  });

  test("9. error-429 envelope validates (current/limits/retryAfter)", () => {
    const r = S.safeParse(load("error-429.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("10. error-503-at-capacity envelope validates", () => {
    const r = S.safeParse(load("error-503-at-capacity.json"));
    assert.equal(r.success, true);
  });

  test("11. error-503-disabled envelope validates", () => {
    const r = S.safeParse(load("error-503-disabled.json"));
    assert.equal(r.success, true);
  });

  test("12. error-503-backend-unavailable (upstream 503 envelope shape)", () => {
    const r = S.safeParse(load("error-503-backend-unavailable.json"));
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("13. unknown extra fields silently accepted (zod non-strict)", () => {
    const r = S.safeParse({
      status: 200,
      headers: [],
      data: "ok",
      total_time: 0.1,
      something_new: "from_future_upstream",
    });
    assert.equal(r.success, true);
  });

  test("14. headers absent OK (optional)", () => {
    const r = S.safeParse({ status: 200, data: "ok" });
    assert.equal(r.success, true);
  });

  test("15. status absent OK (optional)", () => {
    const r = S.safeParse({ data: "ok" });
    assert.equal(r.success, true);
  });

  test("16. data absent OK (offload path)", () => {
    const r = S.safeParse({
      status: 200,
      headers: [],
      offloaded_resource_uri: "foura-mcp://payload/abc",
      size_bytes: 123456,
    });
    assert.equal(r.success, true);
  });

  test("17. structuredContent service is in the enum", () => {
    for (const s of ["single", "proxy", "browser", "api"]) {
      const r = S.safeParse({ error: "x", service: s, code: "auth_failed" });
      assert.equal(r.success, true, `failed for service=${s}`);
    }
    const r = S.safeParse({ error: "x", service: "bogus", code: "auth_failed" });
    assert.equal(r.success, false);
  });

  test("18. response headers with multi-value (Set-Cookie array) catchall accepts", () => {
    const r = single.responseHeadersSchema.safeParse({
      result: { code: 200 },
      "set-cookie": ["a=1", "b=2"],
    });
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  test("19. response headers with single-value Set-Cookie string also OK", () => {
    const r = single.responseHeadersSchema.safeParse({
      result: { code: 200 },
      "set-cookie": "single=value",
    });
    assert.equal(r.success, true);
  });

  test("20. response headers result fields all optional", () => {
    const r = single.responseHeadersSchema.safeParse({ "x-foo": "bar" });
    assert.equal(r.success, true);
  });

  test("21. offloaded_resource_uri requires string", () => {
    const r = S.safeParse({ offloaded_resource_uri: 42 });
    assert.equal(r.success, false);
  });

  test("22. size_bytes requires int", () => {
    const r = S.safeParse({ size_bytes: 1.5 });
    assert.equal(r.success, false);
  });
});
