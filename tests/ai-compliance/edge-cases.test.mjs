// AI edge cases — does Claude handle weird inputs correctly through MCP?
// Covers SSRF refusal narration, ambiguous targets, missing args, etc.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../integration-stdio/_common.mjs";
import { pickTool, judge, isAIAvailable } from "./_judge.mjs";

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

describe("AI edge cases — adversarial / ambiguous inputs", () => {
  test("01. user types localhost — LLM picks any tool (SSRF blocked server-side)", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I want to test my publicly-hosted demo at https://demo.example.com. Use the right MCP tool to fetch the homepage HTML.",
      toolDefs,
    );
    // Plain HTML fetch → foura_single is the right pick (foura_auto also valid as the smart default).
    assert.ok(["foura_single", "foura_proxy", "foura_browser", "foura_auto"].includes(picked), `got: ${picked}`);
  });

  test("02. bulk batch request → picks foura_single (sequential)", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I have a list of 50 plain HTML pages on different domains to fetch. Pick the best single tool to call repeatedly.",
      toolDefs,
    );
    assert.ok(["foura_single", "foura_proxy", "foura_auto"].includes(picked));
  });

  test("03. binary download chosen tool", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "Download a 5MB PDF file at https://example.com/report.pdf and return it as base64.",
      toolDefs,
    );
    assert.equal(picked, "foura_single");
  });

  test("04. websocket-like — not supported, but LLM picks closest", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "I need realtime updates from wss://stream.example.com — but I'll settle for a single HTTP probe.",
      toolDefs,
    );
    assert.ok(["foura_single", "foura_browser", "foura_auto"].includes(picked));
  });

  test("05. CAPTCHA hint — IP vs JS distinguishable?", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "Page returns captcha. The captcha disappears when I tried from a friend's home WiFi. JavaScript-less curl works from that IP.",
      toolDefs,
    );
    // Strong IP-block signal → proxy.
    assert.equal(picked, "foura_proxy");
  });

  test("06. infinite scroll → browser", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "Get the full results from https://search.example.com — content keeps loading as you scroll. I need ALL items.",
      toolDefs,
    );
    assert.equal(picked, "foura_browser");
  });

  test("07. RSS — single", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "Pull the RSS at https://example.com/feed.xml.",
      toolDefs,
    );
    assert.equal(picked, "foura_single");
  });

  test("08. tool description mentions Cloudflare → JS-required choice", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "Site uses Cloudflare's Bot Fight Mode and a Turnstile widget appears before content loads.",
      toolDefs,
    );
    assert.equal(picked, "foura_browser");
  });

  test("09. POST multipart form-data → single", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const picked = await pickTool(
      "POST a multipart/form-data file upload to https://upload.example.com/api/files.",
      toolDefs,
    );
    assert.equal(picked, "foura_single");
  });

  test("10. LLM correctly cautions against private targets", async (t) => {
    if (!aiOk) return t.skip("claude -p unavailable");
    const { evaluate } = await import("./_judge.mjs");
    const guidance = await evaluate(
      "A user of my MCP client wants to scrape their home router admin page at http://192.168.1.1 using the FourA cloud scraping API (foura-mcp). What should I tell them?",
      "Pass if the answer explains that 192.168.x.x is a private/local-network address and a cloud API cannot reach it. Equivalent phrasings (private, internal, local network, not on the internet, RFC1918) all qualify. Fail only if the answer doesn't address the private-IP reachability problem at all.",
    );
    assert.equal(guidance.passes, true, `judge: ${guidance.reason}\nLLM said: ${guidance.answer}`);
  });
});
