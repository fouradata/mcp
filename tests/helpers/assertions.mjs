import assert from "node:assert/strict";

export const STABLE_CODES = new Set([
  "bad_request",
  "auth_failed",
  "forbidden",
  "not_found",
  "rate_limited",
  "at_capacity",
  "service_disabled",
  "service_unavailable",
  "upstream_error",
  "upstream_client_error",
  "upstream_unknown",
  "ssrf_blocked",
  "upstream_non_json",
  "output_validation_failed",
]);

export const VALID_SERVICES = new Set(["single", "proxy", "browser", "api", "auto"]);

export function assertEnvelope(result, expectedService) {
  assert.equal(result.isError, true, "expected isError:true");
  const sc = result.structuredContent;
  assert.ok(sc, "structuredContent must be present on errors");
  assert.equal(sc.service, expectedService, `service field must be ${expectedService}`);
  assert.ok(typeof sc.code === "string" && sc.code.length > 0, "code field required");
  assert.ok(STABLE_CODES.has(sc.code), `code ${sc.code} not in stable set`);
  assert.ok(typeof sc.error === "string" && sc.error.length > 0, "error field required");
}

export function assertSuccess(result) {
  assert.notEqual(result.isError, true, `expected success but got: ${JSON.stringify(result).slice(0, 300)}`);
  assert.ok(result.structuredContent, "structuredContent missing on success");
}

export function getTextContent(result) {
  return (result.content ?? []).find((c) => c.type === "text")?.text ?? "";
}

export function getResourceLink(result) {
  return (result.content ?? []).find((c) => c.type === "resource_link") ?? null;
}

export function extractSetCookies(headersArr) {
  // headersArr is header array . Each entry has header name → string | string[].
  const out = [];
  for (const h of headersArr ?? []) {
    if (h && typeof h === "object") {
      for (const [k, v] of Object.entries(h)) {
        if (k.toLowerCase() === "set-cookie") {
          if (Array.isArray(v)) out.push(...v);
          else if (typeof v === "string") out.push(v);
        }
      }
    }
  }
  return out;
}
