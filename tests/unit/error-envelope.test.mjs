import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { single, proxy, browser } from "../helpers/schemas.mjs";

describe("deriveCode - matrix from API and transport error semantics", () => {
  const cases = [
    { name: "1. 400 -> bad_request", status: 400, envelope: {}, expected: "bad_request" },
    { name: "2. 401 -> auth_failed", status: 401, envelope: {}, expected: "auth_failed" },
    { name: "3. 403 -> forbidden", status: 403, envelope: {}, expected: "forbidden" },
    { name: "4. 404 -> not_found", status: 404, envelope: {}, expected: "not_found" },
    { name: "5. 429 -> rate_limited", status: 429, envelope: {}, expected: "rate_limited" },
    { name: "6. 429 + retryAfter ignored for code", status: 429, envelope: { retryAfter: 60 }, expected: "rate_limited" },
    { name: "7. 503 + current -> at_capacity", status: 503, envelope: { current: { concurrency: 5, rpm: 60 } }, expected: "at_capacity" },
    { name: "8. 503 + 'Service disabled' -> service_disabled", status: 503, envelope: { error: "Service disabled for your account" }, expected: "service_disabled" },
    { name: "9. 503 + 'SERVICE DISABLED' upper-case -> service_disabled (case-insensitive)", status: 503, envelope: { error: "SERVICE DISABLED" }, expected: "service_disabled" },
    { name: "10. 503 + other error -> service_unavailable", status: 503, envelope: { error: "something" }, expected: "service_unavailable" },
    { name: "11. 503 empty -> service_unavailable", status: 503, envelope: {}, expected: "service_unavailable" },
    { name: "12. 500 -> upstream_error", status: 500, envelope: {}, expected: "upstream_error" },
    { name: "13. 502 -> upstream_error", status: 502, envelope: {}, expected: "upstream_error" },
    { name: "14. 504 -> upstream_error", status: 504, envelope: {}, expected: "upstream_error" },
    { name: "15. 418 -> upstream_client_error", status: 418, envelope: {}, expected: "upstream_client_error" },
    { name: "16. 451 -> upstream_client_error", status: 451, envelope: {}, expected: "upstream_client_error" },
    { name: "17. 200 -> upstream_unknown (defensive)", status: 200, envelope: {}, expected: "upstream_unknown" },
    { name: "18. 0 -> upstream_unknown (curl conn-failed status)", status: 0, envelope: {}, expected: "upstream_unknown" },
    { name: "19. 999 -> upstream_error", status: 999, envelope: {}, expected: "upstream_error" },
  ];

  for (const c of cases) {
    test(`${c.name} (single)`, () => assert.equal(single.deriveCode(c.status, c.envelope), c.expected));
  }
});

describe("deriveCode - same matrix produces identical output across all 3 tools (duplication parity)", () => {
  // Each tool file owns its own deriveCode (intentional duplication per
  // feedback_foura_endpoints_independent_schemas). Sanity-check they agree.
  const samples = [
    { status: 401, envelope: {} },
    { status: 429, envelope: { retryAfter: 5 } },
    { status: 503, envelope: { current: { concurrency: 1, rpm: 1 } } },
    { status: 503, envelope: { error: "Service disabled" } },
    { status: 502, envelope: {} },
  ];
  for (const s of samples) {
    test(`tools agree on status=${s.status} ${JSON.stringify(s.envelope)}`, () => {
      const a = single.deriveCode(s.status, s.envelope);
      const b = proxy.deriveCode(s.status, s.envelope);
      const c = browser.deriveCode(s.status, s.envelope);
      assert.equal(a, b, `single (${a}) != proxy (${b})`);
      assert.equal(b, c, `proxy (${b}) != browser (${c})`);
    });
  }
});
