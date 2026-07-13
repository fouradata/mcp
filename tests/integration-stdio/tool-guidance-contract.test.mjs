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
    assert.match(auto.description ?? "", /keeps trying until the response satisfies it/i);
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
