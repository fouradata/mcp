// Shared spawn helper — one server per test FILE to amortize startup cost.
import { spawnLocalServer } from "../helpers/stdio-client.mjs";

export const TEST_KEY = process.env.FOURA_API_KEY
  ?? process.env.DW_TEST_API_KEY;

export async function startServer(envOverrides = {}) {
  return spawnLocalServer({ FOURA_API_KEY: TEST_KEY, ...envOverrides });
}
