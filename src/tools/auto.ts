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

// This API route is exact and must not have a trailing slash.
const AUTO_API_URL =
  (process.env.FOURA_API_BASE ?? "https://api.foura.ai/api") + "/auto";

// Apply the client's success criteria to every fetch attempt.
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
          .describe("Case-insensitive header substring rules. The response passes when at least one name/value pair matches."),
        fail: z
          .record(z.string(), z.string())
          .optional()
          .describe("Case-insensitive header substring rules that reject the response when any name/value pair matches."),
      })
      .optional()
      .describe("Header validation: pass when an accepted header matches, fail when a blocklisted header matches."),
    data: z
      .object({
        accept: z.array(z.string()).optional().describe("Case-sensitive substrings the final body must contain. Use this on protected targets to distinguish the real page from a challenge page."),
        fail: z.array(z.string()).optional().describe("Substrings the final body must not contain"),
      })
      .optional()
      .describe("Body validation: pass when the body contains an expected substring (accept), fail when it contains a blocked one (fail)."),
  })
  .optional()
  .describe("Post-fetch response validation. When the response fails these checks foura_auto returns an error envelope.");

// Response headers come back as an array of per-hop objects (same shape the
// other tools surface). `result` carries the status line; every other key is a
// response header name -> value (string, or array of strings for multi-value
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

// Completion details returned with every auto response.
const AutoMetaSchema = z
  .object({
    rung: z.string().optional().describe("Which method delivered the content (e.g. probe / proxy / browser / cache). `cache` means a reusable session was used."),
    solved: z.boolean().optional().describe("True when a bot-defense was actively solved on the way to the content (vs. the target being open)."),
    attempts: z.number().optional().describe("Total fetch attempts made for this request."),
    credits: z.number().optional().describe("Total credits spent across all attempts."),
  })
  .catchall(z.unknown());

// Reusable session values for clients that need a follow-up request.
const AutoSessionSchema = z
  .object({
    proxy: z.string().optional().describe("Opaque base36 exit id of the session (e.g. `4DZ3VE`) - pass to foura_single.proxy / foura_proxy.proxy to replay through the same exit. Never a raw IP."),
    cookies: z.unknown().optional().describe("Cookie objects accumulated by the winning session. For foura_single, serialize their name/value pairs into a Cookie header; pass the array directly to foura_browser.cookies."),
    userAgent: z.string().optional().describe("User-Agent used by the winning session. Send it as a User-Agent header to foura_single or as foura_browser.userAgent."),
  })
  .catchall(z.unknown());

const autoOutputShape = {
  // Success path - single-shaped body so any client that renders foura_single
  // also renders auto. Note: NO `total_time` (auto does not surface it).
  status: z
    .number()
    .int()
    .optional()
    .describe("HTTP status code from the request that delivered the content. `0` means no HTTP response was received; check `error`."),
  headers: z
    .union([z.array(ResponseHeadersSchema), z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Response headers from the successful request, as an array of objects. Each entry has `result.{version, code, reason}` plus header-name keys. The last entry is the final response."),
  data: z
    .unknown()
    .optional()
    .describe("Decoded response body of the delivered page. String by default; object when the body parsed as JSON. Omitted when offloaded."),
  meta: AutoMetaSchema.optional().describe("Completion details: rung, solved, attempts, and credits. Always present."),
  session: AutoSessionSchema.optional().describe("Reusable {proxy, cookies, userAgent} values for follow-up calls. For plain HTTP, call foura_single with session.proxy as proxy, session.userAgent as a User-Agent header, and session.cookies serialized as a Cookie header. For JavaScript, pass the three values to foura_browser fields. Present by default; send returnSession:false to omit."),
  // Resource-link fields used when the response body is offloaded.
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>. Pass this URI to resources/read to retrieve the offloaded body."),
  size_bytes: z.number().int().optional().describe("Total offloaded body size in bytes"),
  // Error path - auto failure surfaces the failure status + message + attempts.
  error: z.string().optional().describe("Human-readable error message when the request could not deliver content within the budget."),
  attempts: z.number().optional().describe("Total attempts when the request failed (also present inside `meta`)."),
  service: z.enum(["single", "proxy", "browser", "api", "auto"]).optional(),
  retryAfter: z.number().optional().describe("Seconds to wait before retrying a 429 or 503 response"),
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
    .describe("Stable error code for retry classification. auth_failed means the FourA API key was rejected; verify that key, not target-site credentials. Other codes: ssrf_blocked, upstream_non_json, output_validation_failed, bad_request (400), forbidden (403), not_found (404), rate_limited (429), at_capacity (503), service_disabled (503), service_unavailable (503), upstream_error (>=500), upstream_client_error (other 4xx), upstream_unknown (defensive)."),
};

const autoInputShape = {
  url: z
    .string()
    .url()
    .describe("Public target URL. Private or reserved targets return `ssrf_blocked`. Use {ts} in the URL to insert the current Unix timestamp. Example: https://example.com/page."),
  method: z
    .string()
    .min(1)
    .optional()
    .describe("HTTP method for the target request (default GET)."),
  headers: z
    .array(z.tuple([z.string(), z.string()]))
    .optional()
    .describe("Custom HTTP headers as [name, value] tuples. Example: [[\"Accept\", \"application/json\"], [\"Authorization\", \"Bearer ...\"]]"),
  data: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Request body for non-GET methods. Strings sent as-is; objects auto-serialized to JSON."),
  validate: AutoValidateSchema,
  returnSession: z
    .boolean()
    .optional()
    .describe("Return reusable {proxy, cookies, userAgent} values for follow-up calls. Default true. Send false for a leaner response when you only need the content."),
  forceProxy: z
    .boolean()
    .optional()
    .describe("Require proxy routing for every target request. Default true. Send false to allow direct HTTP when suitable."),
  timeout_ms: z
    .number()
    .int()
    .min(5_000)
    .max(180_000)
    .optional()
    .describe("Total time budget in ms for the whole operation. Every attempt must fit inside it. Default 120000, max 180000."),
  ignoreProxies: z
    .array(z.string())
    .optional()
    .describe("Exits to avoid - base36 proxy IDs (like \"4DZ3VE\") or proxy URLs. Use this to rotate away from an exit that was just blocked."),
  followRedirects: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Follow up to N redirects for HTTP and proxy requests. Default 5; 0 means don't follow. Browser navigation handles redirects itself."),
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies of 50 KB or more are returned as a resource_link instead of inlined. Default false. Read the returned offloaded_resource_uri with resources/read."),
};

// Convert handler and output-validation failures into the documented error envelope.
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
        "Give it a public URL and get the content back. This is the default when you don't want to choose " +
        "between HTTP, proxy rotation, and a full browser. On protected targets, or whenever HTTP 200 may " +
        "still be a challenge or incomplete page, pass validate.data.accept with text unique to the real " +
        "content. Auto makes bounded attempts and returns either validated content or a failure; it cannot " +
        "guarantee a match. The response includes completion details and, " +
        "by default, reusable session values for follow-up calls. Use a lower-level tool when you need " +
        "direct control over HTTP, proxy selection, or browser navigation.",
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
          "User-Agent": "foura-mcp/0.5.0 (auto)",
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

      // Handle transport-level rate-limit, authentication, and capacity errors.
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

      // A non-empty error marks failure. A validated non-2xx status can still be successful.
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

// Export helpers for unit and schema checks.
export const __test = { deriveCode, ResponseHeadersSchema, AutoValidateSchema, autoInputShape, autoOutputShape, guardHandler, AUTO_API_URL };
