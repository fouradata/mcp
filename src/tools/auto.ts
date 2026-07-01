import { request } from "undici";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApiKey } from "../auth.js";
import { assertPublicTarget, SsrfBlockedError } from "../safe-target.js";
import { storePayload, THRESHOLD_BYTES } from "../resources.js";

function extractContentType(headers: unknown): string | null {
  if (!Array.isArray(headers)) return null;
  for (const h of headers) {
    if (h && typeof h === "object") {
      const entries = Object.entries(h as Record<string, unknown>);
      for (const [k, v] of entries) {
        if (k.toLowerCase() === "content-type") {
          const value = Array.isArray(v) ? v[0] : v;
          if (typeof value === "string") return value.split(";")[0]?.trim() ?? null;
        }
      }
    }
  }
  return null;
}

// Derive a stable error code from upstream HTTP status + envelope.
// LLM agents read `code` for retry / classify logic without parsing prose.
// Same code set as the other three tools - auto reuses them verbatim.
function deriveCode(status: number, envelope: Record<string, unknown>): string {
  if (status === 400) return "bad_request";
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 503) {
    if (envelope.current) return "at_capacity";
    const err = typeof envelope.error === "string" ? envelope.error : "";
    if (err.toLowerCase().includes("disabled")) return "service_disabled";
    return "service_unavailable";
  }
  if (status >= 500) return "upstream_error";
  if (status >= 400) return "upstream_client_error";
  return "upstream_unknown";
}

// /api/auto is registered on the gateway WITHOUT a trailing slash (the route is
// an exact `POST /api/auto`), unlike /single/ /proxy/ /browser/ which keep the
// slash. Hitting `/auto/` would miss the dedicated handler and fall through to
// the transparent table - so this URL must stay slash-less.
const AUTO_API_URL =
  (process.env.FOURA_API_BASE ?? "https://api.foura.ai/api") + "/auto";

// The client's success criteria, passed verbatim to auto's internal sub-calls.
// Same DwValidate shape as foura_single / foura_proxy - auto enforces it on
// every rung itself, so a rung that only superficially "succeeds" (e.g. a
// challenge interstitial) is rejected and the ladder keeps climbing.
const AutoValidateSchema = z
  .object({
    status: z
      .object({
        accept: z.array(z.number().int()).optional().describe("HTTP status codes to treat as success"),
        fail: z.array(z.number().int()).optional().describe("HTTP status codes to treat as failure"),
      })
      .optional()
      .describe("Status-code validation: which HTTP status codes count as success (accept) or failure (fail)."),
    headers: z
      .object({
        accept: z
          .record(z.string(), z.string())
          .optional()
          .describe("Map of header-name-substring → header-value-substring (case-insensitive). PASSES if at least one entry matches a response header."),
        fail: z
          .record(z.string(), z.string())
          .optional()
          .describe("Map of header-name-substring → header-value-substring (case-insensitive). FAILS if any entry matches a response header (use to reject challenge / block headers)."),
      })
      .optional()
      .describe("Header validation: pass when an accepted header matches, fail when a blocklisted header matches."),
    data: z
      .object({
        accept: z.array(z.string()).optional().describe("Substrings the final body MUST contain for the fetch to count as solved (CASE-SENSITIVE). Strongly recommended on protected targets so auto can tell a real page from a challenge page."),
        fail: z.array(z.string()).optional().describe("Substrings the final body must NOT contain"),
      })
      .optional()
      .describe("Body validation: pass when the body contains an expected substring (accept), fail when it contains a blocked one (fail)."),
  })
  .optional()
  .describe("Post-fetch response validation. When the response fails these checks foura_auto returns an error envelope.");

// Response headers come back as an array of per-hop objects (same shape the
// other tools surface). `result` carries the status line; every other key is a
// response header name → value (string, or array of strings for multi-value
// headers like Set-Cookie / Link).
const ResponseHeadersSchema = z
  .object({
    result: z
      .object({
        version: z.string().optional(),
        code: z.number().int().optional(),
        reason: z.string().optional(),
      })
      .optional(),
  })
  .catchall(z.union([z.string(), z.array(z.string())]));

// The trace auto always returns: which rung delivered, whether a defense was
// solved, how many sub-call attempts it took, and the summed credits.
const AutoMetaSchema = z
  .object({
    rung: z.string().optional().describe("Which rung delivered the content (e.g. probe / proxy / browser / cache). `cache` means a warm session was replayed cheaply."),
    solved: z.boolean().optional().describe("True when a bot-defense was actively solved on the way to the content (vs. the target being open)."),
    attempts: z.number().optional().describe("Total internal sub-call attempts across the whole ladder."),
    credits: z.number().optional().describe("Total credits spent (sum of every internal sub-call). A cold solve is expensive; a subsequent warm replay amortizes to the cheap-fetch cost."),
  })
  .catchall(z.unknown());

// The {proxy, cookies, userAgent} session triple. proxy is the OPAQUE base36
// proxy id (never a raw IP). Returned by default so a power client can DIY-replay
// the same session through foura_single / foura_proxy later.
const AutoSessionSchema = z
  .object({
    proxy: z.string().optional().describe("Opaque base36 exit id of the session (e.g. `4DZ3VE`) - pass to foura_single.proxy / foura_proxy.proxy to replay through the same exit. Never a raw IP."),
    cookies: z.unknown().optional().describe("Cookies accumulated by the winning session - replay them on a follow-up request."),
    userAgent: z.string().optional().describe("User-Agent string the winning session used - send the same one when replaying."),
  })
  .catchall(z.unknown());

const autoOutputShape = {
  // Success path - single-shaped body so any client that renders foura_single
  // also renders auto. Note: NO `total_time` (auto does not surface it).
  status: z
    .number()
    .int()
    .optional()
    .describe("HTTP status code from the target on the rung that delivered the content. `0` indicates the whole ladder failed before any HTTP response - check `error`."),
  headers: z
    .union([z.array(ResponseHeadersSchema), z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Response headers from the delivering rung, as an array of objects. Each entry has `result.{version, code, reason}` plus arbitrary header-name keys whose values are strings (or arrays of strings for multi-value headers like Set-Cookie / Link). Last array entry is the final response."),
  data: z
    .unknown()
    .optional()
    .describe("Decoded response body of the delivered page. String by default; object when the body parsed as JSON. Omitted when offloaded."),
  meta: AutoMetaSchema.optional().describe("Trace of what the ladder did: rung, solved, attempts, credits. Always present."),
  session: AutoSessionSchema.optional().describe("The {proxy, cookies, userAgent} triple of the winning session, for DIY replay through foura_single / foura_proxy. Present by default (send returnSession:false to omit)."),
  // Offload path - MCP layer adds these when body >= 50KB AND offload_large=true
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>"),
  size_bytes: z.number().int().optional().describe("Total offloaded body size in bytes"),
  // Error path - auto failure surfaces the failure status + message + attempts.
  error: z.string().optional().describe("Human-readable error message when the ladder could not deliver the content within the budget."),
  attempts: z.number().optional().describe("Total sub-call attempts when the ladder failed (also present inside `meta`)."),
  service: z.enum(["single", "proxy", "browser", "api", "auto"]).optional(),
  retryAfter: z.number().optional().describe("Seconds to wait before retrying (429/503 from the gateway)"),
  current: z
    .object({ concurrency: z.number().optional(), rpm: z.number().optional() })
    .optional()
    .describe("Caller's current usage at error time"),
  limits: z
    .object({ maxConcurrency: z.number().optional(), maxRpm: z.number().optional() })
    .optional()
    .describe("Per-service limits at error time"),
  code: z
    .string()
    .optional()
    .describe("Stable error code for retry classification. One of: ssrf_blocked, upstream_non_json, output_validation_failed, bad_request (400), auth_failed (401), forbidden (403), not_found (404), rate_limited (429), at_capacity (503), service_disabled (503), service_unavailable (503), upstream_error (>=500), upstream_client_error (other 4xx), upstream_unknown (defensive)."),
};

const autoInputShape = {
  url: z
    .string()
    .url()
    .describe("Target URL. Public hosts only - private/reserved ranges (RFC 1918 10/8, 172.16/12, 192.168/16, loopback 127/8, link-local, IPv6 ULA fc00::/7, IPv6 loopback ::1, plus *.local mDNS) are refused with code `ssrf_blocked`. Example: https://example.com/page. Use {ts} anywhere in the URL to insert the current Unix timestamp for cache-bust."),
  method: z
    .string()
    .min(1)
    .optional()
    .describe("HTTP method for the target request (default GET)."),
  headers: z
    .array(z.tuple([z.string(), z.string()]))
    .optional()
    .describe("Custom HTTP headers to send to the TARGET, as [name, value] tuples. Example: [[\"Accept\", \"application/json\"], [\"Authorization\", \"Bearer ...\"]]"),
  data: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Request body for non-GET methods. Strings sent as-is; objects auto-serialized to JSON."),
  validate: AutoValidateSchema,
  returnSession: z
    .boolean()
    .optional()
    .describe("Return the {proxy, cookies, userAgent} session triple of the winning session so you can replay it through foura_single / foura_proxy later. Default true. Send false for a leaner response when you only need the content."),
  forceProxy: z
    .boolean()
    .optional()
    .describe("Always reach the target through a rotating proxy, never from FourA's own egress. Default true (the target never sees FourA's origin IP). Send false to allow the cheaper direct path - but note some trust-gated defenses actually resolve more easily from the direct egress, so forcing a proxy can make those targets harder (more attempts / credits)."),
  timeout_ms: z
    .number()
    .int()
    .min(5_000)
    .max(180_000)
    .optional()
    .describe("Total time budget in ms for the WHOLE operation - auto fires several internal attempts and they must all fit inside this. Default 120000, max 180000. Auto portions the budget across its attempts; it does not hand the whole budget to one attempt."),
  ignoreProxies: z
    .array(z.string())
    .optional()
    .describe("Exits to AVOID - base36 proxy ids (like \"4DZ3VE\") or proxy URLs. Auto skips a warm session on one of these and tells its internal proxy search to avoid them too. Use to rotate away from an exit that just got blocked."),
  followRedirects: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Follow up to N redirects on the cheap (direct / proxy) rungs so a 301/302 lands on the real content instead of being returned as-is. Default 5; 0 = don't follow. The browser rung follows redirects natively."),
  //  parity - opt-in offload. Default false → response inline regardless of
  // size so clients that can't read resource_link blocks still get usable output.
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies >= 50KB are written to disk and returned as a resource_link instead of inlined. Saves token context but requires a client that supports `resources/read`. Default false."),
};

// Convert any handler-level crash OR output-validation failure into the
// documented {service, code, error} envelope (same guard as the other tools).
async function guardHandler(
  service: "auto",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: z.ZodObject<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => Promise<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  try {
    const result = await fn();
    if (result?.structuredContent) {
      const parsed = outputSchema.safeParse(result.structuredContent);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map((i) =>
          `${i.path.join(".") || "(root)"}: ${i.message}`,
        ).join("; ");
        return {
          isError: true,
          content: [{ type: "text", text: `FourA ${service} - upstream response failed schema: ${issues}` }],
          structuredContent: {
            service,
            code: "output_validation_failed",
            error: `Upstream response did not match the expected schema: ${issues}`,
          },
        };
      }
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [{ type: "text", text: `FourA ${service} - internal error: ${msg}` }],
      structuredContent: {
        service,
        code: "output_validation_failed",
        error: `Tool handler crashed before producing a response: ${msg}`,
      },
    };
  }
}

export function registerAutoTool(server: McpServer): void {
  server.registerTool(
    "foura_auto",
    {
      title: "FourA - auto (smart fetch, picks the method for you)",
      description:
        "Give a URL, get the content back. The default first choice for any page when you just want " +
        "the data and don't want to decide how to fetch it. Internally it walks a cost-aware ladder - a " +
        "fast direct request first, then a rotating proxy, then a full browser session - escalating only " +
        "as far as the target forces it, solving common bot challenges (Cloudflare, and similar) on the " +
        "way, and cheaply replaying a warm session on repeat calls to the same host. It learns the right " +
        "settings per host on its own, so there are no maxTries / pool / retry knobs to tune. " +
        "Pass `validate` (a substring the real page must contain) on protected targets so it can tell a " +
        "real page from a challenge page. The response includes a `meta` trace (which rung delivered, " +
        "credits spent) and, by default, the winning `session` ({proxy, cookies, userAgent}) so you can " +
        "replay it through foura_single / foura_proxy afterwards. " +
        "Use one of the lower-level tools instead only when you need explicit control: foura_single for a " +
        "specific raw HTTP request, foura_proxy to drive the rotation/exit yourself, foura_browser for a " +
        "scripted browser session.",
      inputSchema: autoInputShape,
      outputSchema: autoOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => guardHandler("auto", z.object(autoOutputShape), async () => {
      try {
        await assertPublicTarget(input.url);
      } catch (e) {
        if (e instanceof SsrfBlockedError) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
            structuredContent: { service: "auto" as const, code: "ssrf_blocked", error: e.message },
          };
        }
        throw e;
      }

      // Strip MCP-layer-only fields before forwarding upstream.
      const { offload_large, ...upstreamBody } = input;

      // auto can run up to its 180s budget; give undici a generous ceiling so it
      // never cuts the orchestrator short (the server-side budget is the real cap).
      const res = await request(AUTO_API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": getApiKey(),
          "Content-Type": "application/json",
          "User-Agent": "foura-mcp/0.4.6 (auto)",
        },
        body: JSON.stringify(upstreamBody),
        headersTimeout: 200_000,
        bodyTimeout: 200_000,
      });

      const text = await res.body.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `FourA auto - non-JSON response (${res.statusCode}): ${text.slice(0, 200)}`,
            },
          ],
          structuredContent: {
            service: "auto" as const,
            code: "upstream_non_json",
            status: res.statusCode,
            error: `Upstream returned non-JSON (${res.statusCode}): ${text.slice(0, 200)}`,
          },
        };
      }

      // Gateway-level error (rate limit / auth / capacity) - auto itself ALWAYS
      // replies transport-200, so a non-2xx transport status is the gateway
      // rejecting before auto ran. Surface it like the other tools do.
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const e = parsed as Record<string, unknown>;
        const errMsg = typeof e.error === "string" ? e.error : "Unknown";
        const retryStr = typeof e.retryAfter === "number" ? ` · retry ${e.retryAfter}s` : "";
        return {
          isError: true,
          content: [{ type: "text", text: `FourA auto error ${res.statusCode}: ${errMsg}${retryStr}` }],
          structuredContent: {
            ...e,
            service: "auto" as const,
            code: deriveCode(res.statusCode, e),
            status: typeof e.status === "number" ? e.status : res.statusCode,
          },
        };
      }

      const parsedObj = parsed as {
        status?: number;
        data?: unknown;
        headers?: unknown;
        meta?: unknown;
        session?: unknown;
        error?: unknown;
        attempts?: number;
      };

      // auto returns transport-200; the real verdict is in the body. The
      // PRIMARY error signal is a non-empty `error` (the ladder failed). A
      // non-2xx body.status WITHOUT an error is a legitimate success (the
      // client's validate accepted that status), so it is NOT an error.
      if (typeof parsedObj.error === "string" && parsedObj.error.length > 0) {
        const innerStatus = typeof parsedObj.status === "number" ? parsedObj.status : 0;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `FourA auto - could not deliver content (status ${innerStatus}): ${parsedObj.error}`,
            },
          ],
          structuredContent: {
            ...(parsedObj as Record<string, unknown>),
            service: "auto" as const,
            code: innerStatus > 0 ? deriveCode(innerStatus, parsedObj as Record<string, unknown>) : "upstream_error",
            status: innerStatus,
          },
        };
      }

      const data = parsedObj.data;
      let bodyStr: string | null = null;
      if (typeof data === "string") bodyStr = data;
      else if (data && typeof data === "object") bodyStr = JSON.stringify(data);

      const statusLabel = parsedObj.status ?? "?";
      const meta = (parsedObj.meta ?? {}) as { rung?: string; credits?: number };
      const rungLabel = meta.rung ? ` · ${meta.rung}` : "";
      const creditLabel = typeof meta.credits === "number" ? ` · ${meta.credits}cr` : "";

      const shouldOffload = offload_large === true
        && bodyStr
        && Buffer.byteLength(bodyStr, "utf8") >= THRESHOLD_BYTES;

      if (shouldOffload && bodyStr) {
        const ct = extractContentType(parsedObj.headers) ?? "text/plain";
        const stored = await storePayload(bodyStr, ct, "response-body");
        const sizeKb = (stored.size / 1024).toFixed(1);
        return {
          content: [
            { type: "text", text: `${statusLabel} · offloaded ${sizeKb} KB${rungLabel}${creditLabel}` },
            { type: "resource_link", uri: stored.uri, name: stored.name, mimeType: stored.mimeType },
          ],
          structuredContent: {
            status: parsedObj.status,
            headers: parsedObj.headers,
            meta: parsedObj.meta,
            session: parsedObj.session,
            offloaded_resource_uri: stored.uri,
            size_bytes: stored.size,
          },
        };
      }

      const sizeKb = bodyStr ? (Buffer.byteLength(bodyStr, "utf8") / 1024).toFixed(1) : "0";
      return {
        content: [{ type: "text", text: `${statusLabel} OK · ${sizeKb} KB${rungLabel}${creditLabel}` }],
        structuredContent: parsedObj as Record<string, unknown>,
      };
    }),
  );
}

// Export internals for unit tests + schema-parity checks.
export const __test = { deriveCode, ResponseHeadersSchema, AutoValidateSchema, autoInputShape, autoOutputShape, guardHandler, AUTO_API_URL };
