import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../helpers/http-client.mjs";

const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;

let tools;
before(async () => {
  const c = new HttpClient({ apiKey: TEST_KEY });
  await c.initialize();
  tools = await c.listTools();
});

describe("mcp.foura.ai tools/list", () => {
  test("1. exactly 4 tools advertised", () => {
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["foura_auto", "foura_browser", "foura_proxy", "foura_single"]);
  });

  test("2. each tool has readOnlyHint:true annotation", () => {
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} missing readOnlyHint`);
    }
  });

  test("3. each tool has destructiveHint:false", () => {
    for (const t of tools) {
      assert.equal(t.annotations?.destructiveHint, false, `${t.name} missing destructiveHint:false`);
    }
  });

  test("4. each tool has openWorldHint:true", () => {
    for (const t of tools) {
      assert.equal(t.annotations?.openWorldHint, true);
    }
  });

  test("5. each tool has outputSchema", () => {
    for (const t of tools) {
      assert.ok(t.outputSchema, `${t.name} missing outputSchema`);
    }
  });

  test("6. each tool has inputSchema with required url", () => {
    for (const t of tools) {
      assert.ok(t.inputSchema);
    }
  });
});
