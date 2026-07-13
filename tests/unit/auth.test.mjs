import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { withApiKey, getApiKey } from "../../dist/auth.js";

// Regression guard for the HTTP key-isolation fix (0.4.8). The invariant:
// while inside a withApiKey() request scope (the HTTP transport path), the
// The request-scoped value is authoritative; getApiKey() must not fall back to
// the process env, or an unauthenticated HTTP request could borrow the host
// operator's FOURA_API_KEY. The env fallback exists strictly for stdio mode,
// where there is no request scope at all.
describe("auth - getApiKey() request-scope isolation", () => {
  let savedEnv;
  before(() => { savedEnv = process.env.FOURA_API_KEY; });
  after(() => {
    if (savedEnv === undefined) delete process.env.FOURA_API_KEY;
    else process.env.FOURA_API_KEY = savedEnv;
  });

  test("stdio mode (no scope): falls back to the FOURA_API_KEY env var", () => {
    process.env.FOURA_API_KEY = "pk_live_env_stdio";
    assert.equal(getApiKey(), "pk_live_env_stdio");
  });

  test("HTTP mode: uses the request-scoped key, not the env", async () => {
    process.env.FOURA_API_KEY = "pk_live_env_must_not_leak";
    await withApiKey("pk_live_request_scoped", async () => {
      assert.equal(getApiKey(), "pk_live_request_scoped");
    });
  });

  test("HTTP mode with an empty key: throws, never borrows the env key", async () => {
    process.env.FOURA_API_KEY = "pk_live_env_must_not_leak";
    await withApiKey("", async () => {
      assert.throws(() => getApiKey(), /No API key on this MCP request/);
    });
  });

  test("no scope and no env: throws the stdio setup error", () => {
    delete process.env.FOURA_API_KEY;
    assert.throws(() => getApiKey(), /FOURA_API_KEY not provided/);
  });
});
