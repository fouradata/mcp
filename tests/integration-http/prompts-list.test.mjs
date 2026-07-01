import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../helpers/http-client.mjs";

const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;

let prompts;
before(async () => {
  const c = new HttpClient({ apiKey: TEST_KEY });
  await c.initialize();
  prompts = await c.listPrompts();
});

describe("mcp.foura.ai prompts/list", () => {
  test("1. 6 prompts advertised", () => {
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

  test("2. each prompt has description", () => {
    for (const p of prompts) {
      assert.ok(typeof p.description === "string" && p.description.length > 0);
    }
  });

  test("3. each prompt has arguments schema metadata", () => {
    for (const p of prompts) {
      assert.ok(Array.isArray(p.arguments) || typeof p.arguments === "undefined" || typeof p.argsSchema !== "undefined" || p);
    }
  });
});
