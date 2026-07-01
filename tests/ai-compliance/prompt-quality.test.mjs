// AI prompt-quality — expand to cover edge inputs for each registered prompt.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../integration-stdio/_common.mjs";
import { judge, isAIAvailable } from "./_judge.mjs";

let client;
let aiOk;
before(async () => {
  aiOk = await isAIAvailable();
  if (aiOk) client = await startServer();
});
after(async () => { await client?.close(); });

const CASES = [
  // ───────── scrape_product_page ─────────
  {
    name: "01. scrape_product_page (techmart) — names browser + expected JSON",
    prompt: "scrape_product_page",
    args: { url: "https://techmart.bg/smartfon-samsung" },
    rubric: "Pass if the text BOTH names the foura_browser tool AND specifies an output JSON structure with field names (title, price, image, in_stock, etc.).",
  },
  {
    name: "02. scrape_product_page (onlinemashini) — same rubric",
    prompt: "scrape_product_page",
    args: { url: "https://onlinemashini.com/parts/abc123" },
    rubric: "Pass if text names foura_browser AND specifies a JSON output structure.",
  },
  {
    name: "03. scrape_product_page (US Amazon-shape URL)",
    prompt: "scrape_product_page",
    args: { url: "https://www.amazon.com/dp/B0XXXXXX" },
    rubric: "Pass if foura_browser is named and JSON output shape is specified.",
  },

  // ───────── extract_article ─────────
  {
    name: "04. extract_article (HN-style server-rendered)",
    prompt: "extract_article",
    args: { url: "https://news.ycombinator.com/item?id=12345" },
    rubric: "Pass if the text names foura_single as the primary tool AND specifies fallback to foura_proxy.",
  },
  {
    name: "05. extract_article (Medium SPA-ish)",
    prompt: "extract_article",
    args: { url: "https://medium.com/some-publication/post-slug" },
    rubric: "Pass if the text names foura_single as primary AND mentions a fallback path.",
  },
  {
    name: "06. extract_article (NYTimes paywalled)",
    prompt: "extract_article",
    args: { url: "https://nytimes.com/2026/05/article-slug.html" },
    rubric: "Pass if the text references extracting headline, author, date AND mentions a proxy fallback for 403.",
  },

  // ───────── monitor_pricing ─────────
  {
    name: "07. monitor_pricing with target",
    prompt: "monitor_pricing",
    args: { url: "https://shop.example.com/p/123", target_price: "29.99" },
    rubric: "Pass if the text contains 29.99 AND instructs the LLM to report the relative position of the current price (below/at/above the target) or the difference. The text is a PROMPT TEMPLATE that gives instructions, not the final comparison itself.",
  },
  {
    name: "08. monitor_pricing without target",
    prompt: "monitor_pricing",
    args: { url: "https://shop.example.com/p/123" },
    rubric: "Pass if the text DOES NOT include 'target_price' or 'compare against target', and reports just the current price.",
  },
  {
    name: "09. monitor_pricing with EUR-ish price",
    prompt: "monitor_pricing",
    args: { url: "https://shop.example.eu/p/abc", target_price: "1299.50" },
    rubric: "Pass if the text references the value 1299.50 and mentions currency handling.",
  },

  // ───────── check_endpoint_health ─────────
  {
    name: "10. check_endpoint_health basic",
    prompt: "check_endpoint_health",
    args: { url: "https://api.example.com/health" },
    rubric: "Pass if the text mentions foura_single's validate.status.accept and asks for reachable/status_code reporting.",
  },
  {
    name: "11. check_endpoint_health with expected_text",
    prompt: "check_endpoint_health",
    args: { url: "https://api.example.com/health", expected_text: "ok" },
    rubric: "Pass if the text references validate.data.accept and the expected substring 'ok'.",
  },
  {
    name: "12. check_endpoint_health long expected text",
    prompt: "check_endpoint_health",
    args: { url: "https://api.example.com/health", expected_text: "DATABASE_READY=true" },
    rubric: "Pass if the text references the exact expected substring 'DATABASE_READY=true' and validate.data.accept.",
  },

  // ───────── bulk_fetch_urls ─────────
  {
    name: "13. bulk_fetch_urls — 3 URLs listed verbatim",
    prompt: "bulk_fetch_urls",
    args: { urls: "https://a.com,https://b.com,https://c.com" },
    rubric: "Pass if the text lists all three URLs (a.com, b.com, c.com) and asks for a per-URL output array.",
  },
  {
    name: "14. bulk_fetch_urls — 5 URLs with mixed http/https",
    prompt: "bulk_fetch_urls",
    args: { urls: "https://example.com,http://example.org,https://example.net,https://example.io,https://example.co" },
    rubric: "Pass if the text references multiple URLs AND mentions concurrency or parallel fetching.",
  },
  {
    name: "15. bulk_fetch_urls — single URL edge case",
    prompt: "bulk_fetch_urls",
    args: { urls: "https://example.com" },
    rubric: "Pass if the text includes 'example.com' and treats it as a list of one.",
  },
];

describe("AI prompt-quality — broad prompt input coverage", () => {
  for (const c of CASES) {
    test(c.name, async (t) => {
      if (!aiOk) return t.skip("claude -p unavailable");
      const got = await client.getPrompt(c.prompt, c.args);
      const text = got?.messages?.[0]?.content?.text ?? "";
      const verdict = await judge(text, c.rubric);
      assert.equal(verdict.passes, true, `judge: ${verdict.reason}\nrendered prompt: ${text.slice(0, 300)}`);
    });
  }
});
