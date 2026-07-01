// AI workflow tests — multi-step LLM tasks against the MCP server.
// Validates that with tools advertised, the LLM picks a sensible plan for
// composite scenarios (escalation, cookie reuse, retry-after).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../integration-stdio/_common.mjs";
import { pickTool, judge, evaluate, isAIAvailable } from "./_judge.mjs";

let toolDefs;
let aiOk;

before(async () => {
  aiOk = await isAIAvailable();
  if (!aiOk) return;
  const client = await startServer();
  try {
    const tools = await client.listTools();
    toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  } finally {
    await client.close();
  }
});

describe("AI workflows — multi-step tasks select sensible escalation paths", () => {
  test("01. escalation single → proxy on 403", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I tried foura_single on https://shop.example.com and got 403 Forbidden. The page is plain HTML — no JS rendering needed. What tool should I try next?",
      toolDefs,
    );
    assert.equal(picked, "foura_proxy");
  });

  test("02. escalation single → browser when JS is required", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I tried foura_single on https://app.example.com and got empty content — the page needs JavaScript to render. What's the right tool to switch to?",
      toolDefs,
    );
    assert.equal(picked, "foura_browser");
  });

  test("03. capture cookies in browser → send via single", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I already have a valid session cookie from a prior browser run. I want to make a follow-up API call with that cookie attached, as plain HTTP.",
      toolDefs,
    );
    assert.equal(picked, "foura_single");
  });

  test("04. retry-after 60s → wait then retry same tool", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "An MCP tool returned an error envelope: {code: 'rate_limited', retryAfter: 60}. What is the correct retry strategy for the developer?",
      "Pass if the answer mentions WAITING approximately 60 seconds AND retrying the same call. Backoff is also acceptable. Fail if it suggests immediate retry or aborting.",
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("05. proxy ID reuse → mention ignoreProxies", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "When using foura_proxy and one specific proxy ID failed on the previous call, what input parameter should I use to make sure that same proxy isn't picked again?",
      "Pass if the answer references ignoreProxies (or equivalent — passing the failing proxy ID into a list of proxies to exclude).",
      { systemHint: "The foura_proxy tool accepts an input parameter named `ignoreProxies` — an array of proxy IDs to skip during rotation." },
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("06. large body — opt-in offload vs inline (regression awareness)", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "By default, MCP tools in foura-mcp return response bodies inline. For a 200KB page, this inflates the token context. Which input flag opts the call into disk-offload via a resource_link instead of inline body?",
      "Pass if the answer references the input parameter offload_large (or equivalent flag name) for opting into resource_link offload.",
      { systemHint: "Each tool (foura_single/proxy/browser) accepts an optional input parameter named `offload_large: boolean`. When true and the body is over 50KB, the body is written to disk and returned as a resource_link content block." },
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("07. ssrf_blocked → user must sanitize input", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "My foura-mcp call failed with {code: 'ssrf_blocked', error: 'Refusing to fetch 127.0.0.1: private/reserved IP'}. The URL came from user input. What should I do to prevent this in production?",
      "Pass if the answer recommends validating or sanitizing user-supplied URLs against private/reserved IP ranges before forwarding.",
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("08. service_disabled → contact support / check plan", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "I called the FourA cloud scraping API through the foura-mcp client and the API returned this error envelope to me: {code: 'service_disabled', error: 'Service disabled'}. The MCP server itself works — this error came from the remote FourA service for my account. What does it mean and what should I do?",
      "Pass if the answer suggests contacting FourA support, checking the FourA account plan/subscription, or asking a FourA admin to enable the service for the account. Any one is enough.",
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("09. choose between foura_proxy maxTries=1 vs higher for cost-sensitive use", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const advice = await evaluate(
      "For cost-sensitive scraping with foura_proxy on a target that usually works on first attempt, what should the maxTries parameter be set to, and why?",
      "Pass if the answer suggests LOW maxTries (1-3) for cost savings, OR explains the tradeoff between cost and success rate clearly.",
    );
    assert.equal(advice.passes, true, `judge: ${advice.reason}\nLLM said: ${advice.answer}`);
  });

  test("10. SSRF-safe URL validation guidance", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I want to fetch https://api.public-data.gov/v2/companies?id=12345 — just JSON, no JS.",
      toolDefs,
    );
    assert.equal(picked, "foura_single");
  });
});
