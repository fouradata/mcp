// Published tool schemas must validate in either JSON Schema dialect a client may implement.
//
// The SDK converts our Zod shapes with a draft-07 target. Two things follow from that and both
// have broken real clients: the emitted schema carries a `$schema` pointing at the draft-07
// meta-schema, and a Zod tuple emits the draft-07 array form of `items`, which 2020-12 replaced
// with `prefixItems`. A client validating strictly against 2020-12 drops such a tool at load
// time, or fails the first call. Neither symptom is visible from a client that happens to
// validate in draft-07, so it is pinned here.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { startServer } from "./_common.mjs";

let client;
let tools;

before(async () => {
  client = await startServer({ FOURA_API_KEY: "schema-dialect-test" });
  tools = await client.listTools();
});

after(async () => { await client?.close(); });

function* walk(node, path = "$") {
  if (Array.isArray(node)) {
    for (const [index, entry] of node.entries()) yield* walk(entry, `${path}[${index}]`);
    return;
  }
  if (node !== null && typeof node === "object") {
    yield [path, node];
    for (const [key, value] of Object.entries(node)) yield* walk(value, `${path}.${key}`);
  }
}

function schemasOf(tool) {
  return [
    ["inputSchema", tool.inputSchema],
    ...(tool.outputSchema ? [["outputSchema", tool.outputSchema]] : []),
  ];
}

describe("published tool schemas are dialect neutral", () => {
  test("every tool publishes an input and an output schema", () => {
    assert.equal(tools.length, 4);
    for (const tool of tools) {
      assert.ok(tool.inputSchema, `${tool.name} input schema`);
      assert.ok(tool.outputSchema, `${tool.name} output schema`);
    }
  });

  test("no schema declares a dialect", () => {
    for (const tool of tools) {
      for (const [kind, schema] of schemasOf(tool)) {
        for (const [path, node] of walk(schema)) {
          assert.ok(
            !Object.hasOwn(node, "$schema"),
            `${tool.name} ${kind} declares a dialect at ${path}`,
          );
        }
      }
    }
  });

  test("no schema uses the draft-07 tuple form", () => {
    for (const tool of tools) {
      for (const [kind, schema] of schemasOf(tool)) {
        for (const [path, node] of walk(schema)) {
          assert.ok(
            !Array.isArray(node.items),
            `${tool.name} ${kind} uses array-form items at ${path}`,
          );
          assert.ok(
            !Object.hasOwn(node, "additionalItems"),
            `${tool.name} ${kind} uses additionalItems at ${path}`,
          );
          assert.ok(
            !Object.hasOwn(node, "prefixItems"),
            `${tool.name} ${kind} uses 2020-12 prefixItems at ${path}`,
          );
        }
      }
    }
  });

  test("every schema compiles under draft-07 and under 2020-12", () => {
    for (const [label, Validator] of [["draft-07", Ajv], ["2020-12", Ajv2020]]) {
      for (const tool of tools) {
        for (const [kind, schema] of schemasOf(tool)) {
          const ajv = new Validator({ strict: false, validateFormats: false });
          assert.doesNotThrow(
            () => ajv.compile(schema),
            `${tool.name} ${kind} under ${label}`,
          );
        }
      }
    }
  });

  test("request headers stay a pair of strings in both dialects", () => {
    const pairFields = [
      ["foura_single", (schema) => schema.properties.headers],
      ["foura_auto", (schema) => schema.properties.headers],
      ["foura_proxy", (schema) => schema.properties.request.properties.headers],
    ];
    for (const [name, pick] of pairFields) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.ok(tool, name);
      const headers = pick(tool.inputSchema);
      assert.equal(headers.type, "array");
      assert.equal(headers.items.type, "array");
      assert.equal(headers.items.minItems, 2);
      assert.equal(headers.items.maxItems, 2);
      assert.deepEqual(headers.items.items, { type: "string" });
    }
  });

  test("a header pair is accepted and a malformed one is rejected", () => {
    const single = tools.find((tool) => tool.name === "foura_single");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(single.inputSchema.properties.headers);
    assert.equal(validate([["Accept", "application/json"]]), true);
    assert.equal(validate([["Accept"]]), false);
    assert.equal(validate([["Accept", "application/json", "extra"]]), false);
    assert.equal(validate([[1, 2]]), false);
  });
});
