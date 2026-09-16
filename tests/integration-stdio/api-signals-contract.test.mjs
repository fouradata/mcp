// The signals the FourA API publishes beside the body: credits, the request id, the class of
// exit that delivered, and the reason a call was refused by the caller's own plan.
//
// Two of these exist ONLY in response headers on /single and /browser, and a plan refusal is a
// 403 or 429 that looks exactly like a target refusing us until you read the reason. A tool that
// drops them is a tool that tells an agent to retry work the plan has already stopped paying for.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnLocalServer } from "../helpers/stdio-client.mjs";
import { getTextContent } from "../helpers/assertions.mjs";

let mockServer;
let client;
let payloadDir;
const requests = [];
const responses = [];

function enqueue(body, { status = 200, headers = {} } = {}) {
  responses.push({ body, status, headers });
}

before(async () => {
  payloadDir = await mkdtemp(path.join(tmpdir(), "foura-mcp-api-signals-"));
  mockServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: req.method, url: req.url, body: JSON.parse(raw) });
    const next = responses.shift();
    if (!next) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected mock request" }));
      return;
    }
    res.writeHead(next.status, { "content-type": "application/json", ...next.headers });
    res.end(JSON.stringify(next.body));
  });
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  client = await spawnLocalServer({
    FOURA_API_KEY: "pk_live_test_dummy",
    FOURA_API_BASE: `http://127.0.0.1:${mockServer.address().port}`,
    FOURA_MCP_PAYLOADS_DIR: payloadDir,
  });
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => mockServer?.close(resolve));
  await rm(payloadDir, { recursive: true, force: true });
});

const target = { method: "GET", url: "https://1.1.1.1/" };

describe("tools/list publishes the extended API contract", () => {
  test("every tool declares the two header-borne fields and the plan-limit code family", async () => {
    const tools = await client.listTools();
    for (const name of ["foura_single", "foura_proxy", "foura_browser", "foura_auto"]) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `${name} is missing`);
      assert.equal(tool.outputSchema?.properties?.credits?.type, "number", `${name}.credits`);
      assert.equal(tool.outputSchema?.properties?.request_id?.type, "string", `${name}.request_id`);
      assert.match(
        tool.outputSchema?.properties?.code?.description ?? "",
        /plan_limit_/,
        `${name}.code must name the plan-limit family`,
      );
    }
  });

  test("foura_proxy declares exitClass in both directions, plus profile and attemptReport", async () => {
    const tools = await client.listTools();
    const proxy = tools.find((t) => t.name === "foura_proxy");
    assert.deepEqual(proxy.inputSchema?.properties?.exitClass?.enum, ["standard", "premium"]);
    assert.match(proxy.inputSchema?.properties?.exitClass?.description ?? "", /allowance, not an instruction/i);
    assert.deepEqual(proxy.outputSchema?.properties?.exitClass?.enum, ["standard", "premium"]);
    assert.equal(proxy.outputSchema?.properties?.profile?.type, "string");
    const report = proxy.outputSchema?.properties?.attemptReport;
    assert.ok(report, "attemptReport is missing from the output schema");
    for (const field of [
      "total", "noResponse", "defense", "contentRejected",
      "statusRejected", "other", "vendors", "profilesTried", "summary",
    ]) {
      assert.ok(report.properties?.[field], `attemptReport.${field} is missing`);
    }
  });

  test("the two tools that can replay a premium exit report the class back", async () => {
    const tools = await client.listTools();
    for (const name of ["foura_single", "foura_browser"]) {
      const tool = tools.find((t) => t.name === name);
      assert.deepEqual(tool.outputSchema?.properties?.exitClass?.enum, ["standard", "premium"]);
    }
  });
});

describe("foura_proxy carries the rotation's own answers", () => {
  test("exitClass rides the existing upstream request, and the response says what served", async () => {
    enqueue(
      { status: 200, data: "ok", proxy: "A1B2C3", exitClass: "premium", total: 0.4 },
      { headers: { "x-foura-credits": "10", "x-foura-request-id": "req-premium-1" } },
    );
    const before = requests.length;
    const result = await client.callTool("foura_proxy", { exitClass: "premium", request: target });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, before + 1, "the field must not cost a second upstream call");
    assert.equal(requests.at(-1).body.exitClass, "premium");
    assert.equal(result.structuredContent.exitClass, "premium");
    assert.equal(result.structuredContent.credits, 10);
    assert.equal(result.structuredContent.request_id, "req-premium-1");
    assert.match(getTextContent(result), /premium/);
  });

  test("the standard pool answering a premium request is a success, not an error", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", exitClass: "standard", total: 0.2 });
    const result = await client.callTool("foura_proxy", { exitClass: "premium", request: target });

    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.exitClass, "standard");
  });

  test("a profile the rotation chose survives to the client", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", profile: "firefox", total: 0.3 });
    const result = await client.callTool("foura_proxy", { request: target });

    assert.equal(result.structuredContent.profile, "firefox");
  });

  test("a failed rotation returns the attempt report instead of one flat sentence", async () => {
    enqueue({
      error: "Download maxTry limit reached",
      request: { request: target },
      total: 34.8,
      attemptReport: {
        total: 25,
        noResponse: 0,
        defense: 0,
        contentRejected: 25,
        statusRejected: 0,
        other: 0,
        vendors: [],
        profilesTried: ["default"],
        summary: "25 attempt(s): 25 returned HTTP 200 with no defense present and were rejected only by your validate.data",
      },
    });
    const result = await client.callTool("foura_proxy", { request: target });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.attemptReport.total, 25);
    assert.equal(result.structuredContent.attemptReport.contentRejected, 25);
    assert.deepEqual(result.structuredContent.attemptReport.profilesTried, ["default"]);
    assert.match(result.structuredContent.attemptReport.summary, /validate\.data/);
  });

  test("an unknown exit class is refused before an upstream request is made", async () => {
    const before = requests.length;
    const result = await client.callTool("foura_proxy", { exitClass: "gold", request: target });

    assert.equal(result.isError, true);
    assert.equal(requests.length, before);
  });

  test("a request that names no class sends none and reads none back", async () => {
    enqueue({ status: 200, data: "ok", proxy: "A1B2C3", total: 0.2 });
    const result = await client.callTool("foura_proxy", { request: target });

    assert.equal(Object.hasOwn(requests.at(-1).body, "exitClass"), false);
    assert.equal(Object.hasOwn(result.structuredContent, "exitClass"), false);
  });
});

describe("the headers every route sets", () => {
  test("foura_single reports credits, the request id, and a premium replay", async () => {
    enqueue(
      { status: 200, data: "ok", total_time: 0.4 },
      {
        headers: {
          "x-foura-credits": "2",
          "x-foura-request-id": "req-single-1",
          "x-foura-exit-class": "premium",
        },
      },
    );
    const result = await client.callTool("foura_single", { ...target });

    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.credits, 2);
    assert.equal(result.structuredContent.request_id, "req-single-1");
    assert.equal(result.structuredContent.exitClass, "premium");
  });

  test("credits are reported on a failure too, because the work was done", async () => {
    enqueue(
      { error: "Download failed", status: 0 },
      { headers: { "x-foura-credits": "5", "x-foura-request-id": "req-single-2" } },
    );
    const result = await client.callTool("foura_single", { ...target });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.credits, 5);
    assert.equal(result.structuredContent.request_id, "req-single-2");
  });

  test("a response without the headers keeps its old shape exactly", async () => {
    enqueue({ status: 200, data: "ok", total_time: 0.1 });
    const result = await client.callTool("foura_single", { ...target });

    assert.equal(Object.hasOwn(result.structuredContent, "credits"), false);
    assert.equal(Object.hasOwn(result.structuredContent, "request_id"), false);
    assert.equal(Object.hasOwn(result.structuredContent, "exitClass"), false);
  });
});

describe("a refusal by the caller's own plan is not a refusal by the target", () => {
  test("403 plan_limit_premium keeps its reason instead of becoming forbidden", async () => {
    enqueue(
      {
        error: "Premium exits (the exitClass parameter) are not included in your plan (Free).",
        reason: "plan_limit_premium",
        documentation: "https://foura.ai/prices",
      },
      { status: 403, headers: { "x-foura-limit": "plan_limit_premium" } },
    );
    const result = await client.callTool("foura_proxy", { exitClass: "premium", request: target });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "plan_limit_premium");
  });

  test("429 plan_limit_credits carries the wait the API measured", async () => {
    enqueue(
      {
        error: "Monthly credits exhausted",
        reason: "plan_limit_credits",
        retry_after_seconds: 3600,
        resets_at: "2026-10-01T00:00:00.000Z",
      },
      { status: 429, headers: { "x-foura-limit": "plan_limit_credits", "retry-after": "3600" } },
    );
    const result = await client.callTool("foura_single", { ...target });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "plan_limit_credits");
    assert.equal(result.structuredContent.retryAfter, 3600);
    assert.match(getTextContent(result), /retry 3600s/);
  });

  test("the header alone is enough when the body shape changes", async () => {
    enqueue(
      { error: "Bandwidth allowance spent" },
      { status: 429, headers: { "x-foura-limit": "plan_limit_bandwidth" } },
    );
    const result = await client.callTool("foura_browser", { url: "https://1.1.1.1/" });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "plan_limit_bandwidth");
  });

  test("a refusal that is not a plan limit still classifies the old way", async () => {
    enqueue({ error: "Invalid API key" }, { status: 401 });
    const result = await client.callTool("foura_single", { ...target });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "auth_failed");
  });
});
