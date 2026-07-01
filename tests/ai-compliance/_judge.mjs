// LLM-as-judge via `claude -p` (headless mode).
// Bypasses the @anthropic-ai/sdk path which requires a raw API key — uses
// Claude Code's OAuth subscription instead. The settings override clears
// any env-injected ANTHROPIC_API_KEY (which is an OAuth token, not an API
// key, so it fails the direct API path).

import { spawn } from "node:child_process";

export const MODEL = process.env.FOURA_TEST_AI_MODEL ?? "haiku";
const SETTINGS_OVERRIDE = JSON.stringify({ env: { ANTHROPIC_API_KEY: "" } });

function runClaude(prompt, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--model", MODEL, "--settings", SETTINGS_OVERRIDE, prompt],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.on("error", reject);
  });
}

let probed = false;
let usable = false;
export async function isAIAvailable() {
  if (probed) return usable;
  probed = true;
  try {
    const r = await runClaude("Reply with the single word PONG and nothing else.", { timeoutMs: 30_000 });
    usable = /pong/i.test(r);
    if (!usable) {
      console.warn(`  ⚠ AI probe returned unexpected output: ${r.slice(0, 100)}`);
    }
  } catch (e) {
    console.warn(`  ⚠ claude -p unavailable: ${e?.message?.slice(0, 200)}`);
    usable = false;
  }
  return usable;
}

export async function pickTool(task, toolDefs) {
  // Render the tool list inline + ask for just the tool name.
  const toolList = toolDefs.map((t) =>
    `- ${t.name}: ${t.description?.slice(0, 600) ?? ""}`,
  ).join("\n");
  const prompt = `You are choosing one MCP tool to call. Available tools:

${toolList}

User task: ${task}

Respond with ONLY the exact tool name (e.g. "foura_single") and nothing else. No quotes, no explanation, no extra words.`;
  const r = await runClaude(prompt);
  return r.split(/\s/)[0]?.trim() ?? null;
}

function extractJudgeJson(text) {
  // Greedy match for outermost {...} containing "passes". Robust to nested
  // quotes/brackets inside the "reason" field.
  const passesIdx = text.indexOf('"passes"');
  if (passesIdx === -1) return null;
  const openIdx = text.lastIndexOf("{", passesIdx);
  if (openIdx === -1) return null;
  // Walk forward, tracking quote state, to find the matching close brace.
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(openIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Try repairing: replace unescaped inner quotes with escaped quotes
          // in the "reason" value. Common when judge writes value text like
          // validate.data.accept:["ok"] without escaping.
          try {
            const repaired = candidate.replace(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/, (m, body) => {
              return `"reason": "${body.replace(/(?<!\\)"/g, '\\"')}"`;
            });
            return JSON.parse(repaired);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

export async function judge(value, rubric) {
  const prompt = `You are a strict JSON evaluator. Given the rubric and value below, respond with ONLY a JSON object on a single line:
{"passes": <true|false>, "reason": "<one short sentence>"}

The reason field MUST NOT contain unescaped double-quote characters. If you need to reference values, paraphrase without quotes.
No prose before or after. No code fences.

Rubric: ${rubric}

Value:
${value}`;
  const r = await runClaude(prompt);
  const parsed = extractJudgeJson(r);
  if (!parsed) return { passes: false, reason: `no JSON: ${r.slice(0, 200)}` };
  return parsed;
}

/**
 * Two-step: ask the LLM to RESPOND to the scenario, then judge its answer
 * against the rubric. Use this for workflow questions where you want to test
 * the answer-quality, not the scenario-text.
 */
export async function evaluate(scenario, rubric, { systemHint } = {}) {
  const sysSuffix = systemHint ? `\n\nContext you can reference if helpful: ${systemHint}` : "";
  const answer = await runClaude(`${scenario}${sysSuffix}\n\nAnswer in 1-3 sentences. Be concrete.`);
  const verdict = await judge(answer, rubric);
  return { ...verdict, answer };
}

export async function actionFromEnvelope(envelope) {
  const prompt = `Context: I'm using the FourA cloud web-scraping API (https://foura.ai). The API is reached through a Model Context Protocol (MCP) client called foura-mcp. The remote FourA API returned this error envelope back to my client:

${JSON.stringify(envelope)}

The "service" field identifies WHICH remote FourA endpoint produced the error (single | proxy | browser | api) — it is NOT a process in my own codebase. The "code" field is FourA's stable error classification. The error originated on the FourA side, not in my own code.

In ONE sentence, what should I (the developer calling the FourA API) do next to resolve this? Be concrete. Reply with just the one sentence, no prefix, no markdown.`;
  return await runClaude(prompt);
}
