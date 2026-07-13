import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_common.mjs";

let client;
let tools;

before(async () => {
  client = await startServer({ FOURA_API_KEY: "tool-guidance-test" });
  tools = await client.listTools();
});

after(async () => { await client?.close(); });

describe("tools/list workflow guidance", () => {
  test("foura_auto requires content validation when a successful status may be misleading", () => {
    const auto = tools.find((tool) => tool.name === "foura_auto");
    assert.ok(auto);
    assert.match(auto.description ?? "", /validate\.data\.accept/);
    assert.match(auto.description ?? "", /bounded attempts/i);
    assert.match(auto.description ?? "", /validated content or a failure/i);
    assert.doesNotMatch(auto.description ?? "", /keeps trying until/i);
  });

  test("smart_fetch prompt describes validation without promising success", async () => {
    const prompt = await client.getPrompt("smart_fetch", {
      url: "https://example.com",
      must_contain: "expected content",
    });
    const text = prompt.messages[0].content.text;
    assert.match(text, /validate\.data\.accept/);
    assert.match(text, /bounded attempts/i);
    assert.match(text, /returns an error if none satisfies/i);
    assert.doesNotMatch(text, /until the real page/i);
  });

  test("every offload path names the standard resource read operation", () => {
    for (const tool of tools) {
      const inputDescription = tool.inputSchema?.properties?.offload_large?.description ?? "";
      const outputDescription = tool.outputSchema?.properties?.offloaded_resource_uri?.description ?? "";
      assert.match(inputDescription, /resources\/read/, `${tool.name} offload input guidance`);
      assert.match(outputDescription, /resources\/read/, `${tool.name} offload output guidance`);
    }
  });
});
