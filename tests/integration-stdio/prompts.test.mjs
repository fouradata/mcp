import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";

let client;
before(async () => { client = await startServer(); });
after(async () => { await client?.close(); });

describe("MCP Prompts — registration + argument plumbing", () => {
  test("1. prompts/list returns exactly 6 named prompts", async () => {
    const prompts = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    assert.deepEqual(names, [
      "bulk_fetch_urls",
      "check_endpoint_health",
      "extract_article",
      "monitor_pricing",
      "scrape_product_page",
      "smart_fetch",
    ]);
  });

  test("2. scrape_product_page renders with url arg", async () => {
    const r = await client.getPrompt("scrape_product_page", { url: "https://techmart.bg/x" });
    assert.ok(r?.messages?.length === 1);
    const text = r.messages[0].content.text;
    assert.ok(text.includes("foura_browser"));
    assert.ok(text.includes("techmart.bg"));
  });

  test("3. extract_article mentions foura_single primary + foura_proxy fallback", async () => {
    const r = await client.getPrompt("extract_article", { url: "https://news.ycombinator.com" });
    const text = r.messages[0].content.text;
    assert.ok(text.includes("foura_single"));
    assert.ok(text.includes("foura_proxy"));
  });

  test("4. monitor_pricing includes target_price comparison", async () => {
    const r = await client.getPrompt("monitor_pricing", {
      url: "https://example.com", target_price: "19.99",
    });
    const text = r.messages[0].content.text;
    assert.ok(text.includes("19.99"));
    assert.match(text, /(below|at|above|compare)/i);
  });

  test("5. monitor_pricing without target_price has no comparison block", async () => {
    const r = await client.getPrompt("monitor_pricing", { url: "https://example.com" });
    const text = r.messages[0].content.text;
    assert.ok(!text.includes("Compare against target"));
  });

  test("6. check_endpoint_health references validate.status.accept", async () => {
    const r = await client.getPrompt("check_endpoint_health", { url: "https://example.com" });
    const text = r.messages[0].content.text;
    assert.ok(text.includes("validate.status.accept"));
  });

  test("7. check_endpoint_health with expected_text uses validate.data.accept", async () => {
    const r = await client.getPrompt("check_endpoint_health", {
      url: "https://example.com", expected_text: "Healthy",
    });
    const text = r.messages[0].content.text;
    assert.ok(text.includes("validate.data.accept"));
    assert.ok(text.includes("Healthy"));
  });

  test("8. bulk_fetch_urls lists the URLs", async () => {
    const r = await client.getPrompt("bulk_fetch_urls", {
      urls: "https://a.com,https://b.com,https://c.com",
    });
    const text = r.messages[0].content.text;
    assert.ok(text.includes("https://a.com"));
    assert.ok(text.includes("https://b.com"));
    assert.ok(text.includes("https://c.com"));
  });

  test("9. tools/list works at the same time as prompts/list", async () => {
    const tools = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ["foura_auto", "foura_browser", "foura_proxy", "foura_single"]);
  });
});
