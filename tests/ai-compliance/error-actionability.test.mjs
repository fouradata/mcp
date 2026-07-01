// AI error-actionability — given a structured error envelope, does the LLM
// produce a useful next action? Covers every stable code + edge envelopes.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { actionFromEnvelope, isAIAvailable } from "./_judge.mjs";

let aiOk;
before(async () => { aiOk = await isAIAvailable(); });

const CASES = [
  // ───────── Rate-limit family ─────────
  {
    name: "01. rate_limited + retryAfter:60 → wait/backoff",
    env: { service: "single", code: "rate_limited", error: "Rate limit exceeded", retryAfter: 60, current: { rpm: 121 }, limits: { maxRpm: 60 } },
    expect: /wait|retry|60\s*sec|backoff|throttle|rate/i,
  },
  {
    name: "02. rate_limited + retryAfter:0/null → exponential backoff",
    env: { service: "proxy", code: "rate_limited", error: "Rate limit exceeded" },
    expect: /backoff|wait|retry|exponential|delay/i,
  },
  {
    name: "03. at_capacity → wait & retry, not abort",
    env: { service: "browser", code: "at_capacity", error: "Service at capacity", retryAfter: 2, current: { concurrency: 6 }, limits: { maxConcurrency: 5 } },
    expect: /wait|retry|capacity|backoff|concurr/i,
  },

  // ───────── Auth / access ─────────
  {
    name: "04. auth_failed → check API key value",
    env: { service: "single", code: "auth_failed", error: "Invalid API key" },
    expect: /key|auth|credentials|invalid|check/i,
  },
  {
    name: "05. service_disabled → enable/contact admin",
    env: { service: "browser", code: "service_disabled", error: "Service disabled" },
    expect: /enable|admin|account|contact|support|disabled|plan/i,
  },
  {
    name: "06. ssrf_blocked → sanitize / public URL only",
    env: { service: "browser", code: "ssrf_blocked", error: "Refusing to fetch 127.0.0.1: target resolves to a private or reserved IP range." },
    expect: /private|local|public|address|target|sanit|valid/i,
  },

  // ───────── Upstream / target failures ─────────
  {
    name: "07. forbidden 403 → target rejected, switch tool/proxy",
    env: { service: "single", code: "forbidden", error: "403 Forbidden", status: 403 },
    expect: /proxy|block|forbidden|anti.bot|switch|rotate|unblock|header|user.agent|cookie|access|permission|allowed/i,
  },
  {
    name: "08. not_found 404 → URL typo or content gone",
    env: { service: "single", code: "not_found", error: "404 Not Found", status: 404 },
    expect: /url|typo|exist|gone|removed|404|check/i,
  },
  {
    name: "09. bad_request 400 → input validation",
    env: { service: "single", code: "bad_request", error: "Invalid request body format", status: 400 },
    expect: /input|valid|format|body|param|request/i,
  },
  {
    name: "10. upstream_error 5xx → transient vs persistent",
    env: { service: "single", code: "upstream_error", error: "502 Bad Gateway", status: 502 },
    expect: /retry|transient|backoff|wait|server|temporary/i,
  },
  {
    name: "11. upstream_non_json → server bug, stale endpoint, or switch tool",
    env: { service: "single", code: "upstream_non_json", error: "Upstream returned non-JSON (502): <html>...</html>", status: 502 },
    expect: /server|html|endpoint|retry|maintenance|wrong|offline|block|switch|try|different|proxy|browser|tool/i,
  },
  {
    name: "12. output_validation_failed → report as bug",
    env: { service: "proxy", code: "output_validation_failed", error: "Upstream response did not match the expected schema: total_time: expected number, received object" },
    expect: /report|bug|server|schema|unexpected|file|issue/i,
  },

  // ───────── Edge envelopes ─────────
  {
    name: "13. proxy timeout (all attempts) → adjust maxTries or timeout",
    env: { service: "proxy", code: "upstream_error", error: "Download maxTry limit reached", request: { maxTries: 5 }, total: 8.2 },
    expect: /retry|maxTries|timeout|increase|backoff|tries/i,
  },
  {
    name: "14. browser navigation timeout → increase or use single",
    env: { service: "browser", code: "upstream_error", error: "Navigation timeout of 30000 ms exceeded", status: 0 },
    expect: /timeout|increase|wait|single|tool/i,
  },
  {
    name: "15. unknown code (defensive)",
    env: { service: "api", code: "upstream_unknown", error: "Unhandled upstream condition" },
    expect: /retry|investigate|log|unknown|handle|report/i,
  },
];

describe("AI error-actionability — every code produces useful next-step guidance", () => {
  for (const c of CASES) {
    test(c.name, async (t) => {
      if (!aiOk) return t.skip("claude -p unavailable");
      const answer = await actionFromEnvelope(c.env);
      assert.match(answer, c.expect, `envelope: ${JSON.stringify(c.env)}\nLLM said: "${answer.slice(0, 250)}"`);
    });
  }
});
