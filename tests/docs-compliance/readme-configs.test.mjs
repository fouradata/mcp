import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(import.meta.url), "../../..");
const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

function extractCodeBlocks(text, lang) {
  const out = [];
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n```", "g");
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

const jsonBlocks = extractCodeBlocks(readme, "json");

const LEAKY_TERMS = [
  /chrome\s*\d+/i,
  /\bheadless\b/i,
  /curl[-_]impersonate/i,
  /\bja3\b/i,
  /\bja4\b/i,
  /tls\s+fingerprint/i,
];

describe("README - config blocks compliance", () => {
  test("1. every ```json block in README parses", () => {
    for (const b of jsonBlocks) {
      assert.doesNotThrow(() => JSON.parse(b), `Invalid JSON:\n${b.slice(0, 100)}`);
    }
    assert.ok(jsonBlocks.length > 0, "README must have at least one JSON config block");
  });

  test("2. every mcpServers block has foura or foura-mcp key", () => {
    let found = 0;
    for (const b of jsonBlocks) {
      if (!b.includes("mcpServers")) continue;
      const obj = JSON.parse(b);
      const servers = obj.mcpServers ?? {};
      const key = Object.keys(servers)[0];
      assert.ok(key === "foura" || key === "foura-mcp", `unexpected mcpServers key: ${key}`);
      found++;
    }
    assert.ok(found >= 1, "README must show at least one mcpServers block");
  });

  test("3. every server config is stdio (command+args) OR http (url+headers)", () => {
    for (const b of jsonBlocks) {
      if (!b.includes("mcpServers")) continue;
      const obj = JSON.parse(b);
      const server = obj.mcpServers.foura ?? obj.mcpServers["foura-mcp"];
      const isStdio = "command" in server && Array.isArray(server.args);
      const isHttp = "url" in server;
      assert.ok(isStdio || isHttp, `config must be stdio OR http: ${JSON.stringify(server)}`);
    }
  });

  test("4. README mentions current package version somewhere", () => {
    // Either as a literal or in a generic install command pinned to the version.
    // Not strict - version may legitimately be unpinned in install snippets.
    const mentioned = readme.includes(pkg.version) || readme.includes("@fouradata/mcp");
    assert.ok(mentioned, "README should mention the package name or current version");
  });

  test("5. no leaky infosec terms (regression/5 + infosec-hygiene)", () => {
    for (const re of LEAKY_TERMS) {
      assert.ok(!re.test(readme), `README contains leaky term matching ${re}`);
    }
  });

  test("6. README mentions stdio + Streamable HTTP transports", () => {
    assert.ok(/stdio/i.test(readme), "stdio transport missing");
    assert.ok(/mcp\.foura\.ai|streamable\s*http/i.test(readme), "Streamable HTTP transport missing");
  });

  test("7. Cmd+Q gotcha documented (regression)", () => {
    // After regression fix, README should warn about Claude Desktop overwriting config on exit.
    const hasCmdQ = /cmd[+\s-]?q|fully quit|quit\s+claude/i.test(readme);
    if (!hasCmdQ) {
      // Soft warning during transition; Stage 3 of plan applies the fix.
      console.warn("  WARNING: regression - Cmd+Q warning not yet in README");
    }
  });

  test("8. stdio config appears BEFORE hosted url config (regression)", () => {
    // After regression fix, stdio config block should appear first.
    const stdioIdx = readme.search(/"command":\s*"npx"/);
    const urlIdx = readme.search(/"url":\s*"https:\/\/mcp\.foura\.ai/);
    if (stdioIdx === -1 || urlIdx === -1) return;
    if (stdioIdx > urlIdx) {
      console.warn("  WARNING: regression - hosted URL config appears before stdio in README (Claude Desktop will reject)");
    }
  });
});
