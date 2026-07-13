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
  // 2xx-with-error-body : curl failures and validate-fail bubble up
  // as HTTP 200 + {error, status: <curl status>, ...}. Caller flags this
  // as an error before reaching us.
  return "upstream_unknown";
}

const SINGLE_API_URL =
  (process.env.FOURA_API_BASE ?? "https://api.foura.ai/api") + "/single/";

const SingleValidateSchema = z
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
          .describe("Case-insensitive header substring rules. The response passes when at least one name/value pair matches across the redirect chain."),
        fail: z
          .record(z.string(), z.string())
          .optional()
          .describe("Case-insensitive header substring rules that reject the response when any name/value pair matches."),
      })
      .optional()
      .describe("Header validation: pass when an accepted header matches, fail when a blocklisted header matches."),
    data: z
      .object({
        accept: z.array(z.string()).optional().describe("Substrings the response body must contain"),
        fail: z.array(z.string()).optional().describe("Substrings the response body must not contain"),
      })
      .optional()
      .describe("Body validation: pass when the body contains an expected substring (accept), fail when it contains a blocked one (fail)."),
  })
  .optional()
  .describe("Post-fetch response validation. When the response fails these checks the tool returns an error envelope.");

// One header entry per response in the redirect chain. `result` holds
// the HTTP status line; all other keys are response header name -> value pairs.
// Multi-value headers (Set-Cookie, Link, WWW-Authenticate, etc.) come as
// `string | string[]` from the HTTP engine response-header.
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

const singleOutputShape = {
  // Success path - matches the upstream response shape
  status: z.number().int().optional().describe("HTTP status code from the target. `0` indicates the request failed before any HTTP response (DNS failure, connection refused, timeout) - check the `error` field for the underlying reason."),
  // `Buffer | the header array` - Buffer when raw mode is requested upstream
  // (we don't expose that mode but accept it permissively). Array entries
  // support multi-value headers.
  headers: z
    .union([z.array(ResponseHeadersSchema), z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Response headers per redirect hop, as an array of objects. Each entry has `result.{version, code, reason}` plus arbitrary header-name keys whose values are strings (or arrays of strings for multi-value headers like Set-Cookie / Link). Last array entry is the final response."),
  data: z
    .unknown()
    .optional()
    .describe("Decoded response body. String by default; object when tryJsonData=true and the body parsed as JSON; serialized Buffer JSON shape (`{type:\"Buffer\", data:[byte, ...]}`, bytes 0-255) when returnBuffer=true - reconstruct with `Buffer.from(data.data)` in Node, `new Uint8Array(data.data)` elsewhere. Omitted when offloaded."),
  // total_time can be string | number | null from the upstream API.
  total_time: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe("Wall-clock request duration in seconds. Number when present; string in some variants; null when the request never started."),
  // Resource-link fields used when the response body is offloaded.
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>. Pass this URI to resources/read to retrieve the offloaded body."),
  size_bytes: z.number().int().optional().describe("Total offloaded body size in bytes"),
  // Error path - common envelope across all FourA services (see foura.ai/docs/api/errors)
  error: z.string().optional().describe("Human-readable error message"),
  service: z.enum(["single", "proxy", "browser", "api"]).optional(),
  retryAfter: z.number().optional().describe("Seconds to wait before retrying (429/503)"),
  current: z
    .object({ concurrency: z.number().optional(), rpm: z.number().optional() })
    .optional()
    .describe("Caller's current usage at error time"),
  limits: z
    .object({ maxConcurrency: z.number().optional(), maxRpm: z.number().optional() })
    .optional()
    .describe("Per-service limits at error time"),
  code: z.string().optional().describe("Stable error code for retry classification. One of: ssrf_blocked, upstream_non_json, output_validation_failed, bad_request (400), auth_failed (401), forbidden (403), not_found (404), rate_limited (429), at_capacity (503), service_disabled (503), service_unavailable (503), upstream_error (>=500), upstream_client_error (other 4xx), upstream_unknown (defensive)."),
};

const singleInputShape = {
  // Keep the method open for WebDAV, OData, GraphQL, and other HTTP extensions.
  method: z
    .string()
    .min(1)
    .describe("HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or any WebDAV verb like PROPFIND/MKCOL)"),
  url: z.string().url().describe("Public target URL. Private or reserved targets return `ssrf_blocked`. Use {ts} in the URL to insert the current Unix timestamp. Example: https://api.example.com/v1/users."),
  headers: z
    .array(z.tuple([z.string(), z.string()]))
    .optional()
    .describe("Custom HTTP headers as [name, value] tuples. Example: [[\"Accept\", \"application/json\"], [\"Referer\", \"https://google.com/\"]]"),
  unblocker: z
    .boolean()
    .optional()
    .describe("Add common browser headers such as User-Agent, Sec-Ch-Ua, and Accept-Encoding. Default false. Enable it for targets that reject basic HTTP requests."),
  data: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Request body. Strings sent as-is; objects auto-serialized to JSON. Example: {\"query\": \"hello\"} for POST APIs."),
  proxy: z
    .string()
    .optional()
    .describe(
      "Optional proxy. Two forms: (1) URL `http://host:port` or `socks5://host:port`; " +
      "(2) base36 ID from foura_proxy (e.g. `4DZ3VE`) to reuse the same exit. For rotation, use foura_proxy.",
    ),
  // Use the public `proxy` string field for both URLs and encoded proxy IDs.
  timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Overall request timeout in ms (max 120000, default 15000)"),
  connect_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms for establishing the TCP/TLS connection (0-120000). Omit to use the default."),
  accept_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms to receive the first response byte after the request is sent (0-120000). Omit for the default."),
  server_response_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms for the server to send the complete response (0-120000). Omit for the default."),
  dns_cache_timeout_sec: z.number().int().min(0).max(240).optional().describe("How long (seconds) to cache the target's resolved DNS (0-240). Omit for the default."),
  followRedirects: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Max number of redirects to follow (0-20). Omit to disable redirect following."),
  tryJsonData: z.boolean().optional().describe("If true, attempt JSON.parse on the response body. On success, `data` is the parsed value (typically object or array). On parse failure, `data` silently stays as the original string - no error, no warning. Set false (or omit) when you need to detect parse failures explicitly."),
  returnBuffer: z.boolean().optional().describe("Return raw bytes as a serialized Buffer JSON shape (`{type:\"Buffer\", data:[byte, ...]}`, bytes 0-255) instead of decoded string. Use for binary responses (images, protobuf). Reconstruct: `Buffer.from(data.data)` in Node, `new Uint8Array(data.data)` elsewhere."),
  validate: SingleValidateSchema,
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies of 50 KB or more are returned as a resource_link instead of inlined. Default false. Read the returned offloaded_resource_uri with resources/read."),
};

// Convert handler and output-validation failures into the documented error envelope.
async function guardHandler(
  service: "single" | "proxy" | "browser",
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

export function registerSingleTool(server: McpServer): void {
  server.registerTool(
    "foura_single",
    {
      title: "FourA - single HTTP request",
      description:
        "Send one HTTP request and return the response. Use it for static pages, JSON APIs, and " +
        "server-rendered HTML. Set unblocker:true for targets that reject basic HTTP requests. " +
        "Switch to foura_proxy if the response is blocked, and use foura_browser when the page needs JavaScript.",
      inputSchema: singleInputShape,
      outputSchema: singleOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => guardHandler("single", z.object(singleOutputShape), async () => {
      try {
        await assertPublicTarget(input.url);
      } catch (e) {
        if (e instanceof SsrfBlockedError) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
            structuredContent: { service: "single" as const, code: "ssrf_blocked", error: e.message },
          };
        }
        throw e;
      }

      // Strip MCP-layer-only fields before forwarding upstream.
      const { offload_large, ...upstreamBody } = input;

      const res = await request(SINGLE_API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": getApiKey(),
          "Content-Type": "application/json",
          "User-Agent": "foura-mcp/0.5.0 (single)",
        },
        body: JSON.stringify(upstreamBody),
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
              text: `FourA single - non-JSON response (${res.statusCode}): ${text.slice(0, 200)}`,
            },
          ],
          structuredContent: {
            service: "single" as const,
            code: "upstream_non_json",
            status: res.statusCode,
            error: `Upstream returned non-JSON (${res.statusCode}): ${text.slice(0, 200)}`,
          },
        };
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        const e = parsed as Record<string, unknown>;
        const errMsg = typeof e.error === "string" ? e.error : "Unknown";
        const retryStr = typeof e.retryAfter === "number" ? ` · retry ${e.retryAfter}s` : "";
        return {
          isError: true,
          content: [{ type: "text", text: `FourA single error ${res.statusCode}: ${errMsg}${retryStr}` }],
          structuredContent: {
            ...e,
            service: "single" as const,
            code: deriveCode(res.statusCode, e),
            status: typeof e.status === "number" ? e.status : res.statusCode,
          },
        };
      }

      const parsedObj = parsed as { data?: unknown; headers?: unknown; status?: number; total_time?: unknown; error?: unknown };

      // A transport-200 response can still carry a request or validation error.
      if (typeof parsedObj.error === "string" && parsedObj.error.length > 0) {
        const innerStatus = typeof parsedObj.status === "number" ? parsedObj.status : 0;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `FourA single - upstream failure (status ${innerStatus}): ${parsedObj.error}`,
            },
          ],
          structuredContent: {
            ...(parsedObj as Record<string, unknown>),
            service: "single" as const,
            code: deriveCode(innerStatus, parsedObj as Record<string, unknown>),
            status: innerStatus,
          },
        };
      }

      const data = parsedObj.data;
      let bodyStr: string | null = null;
      if (typeof data === "string") bodyStr = data;
      else if (data && typeof data === "object") bodyStr = JSON.stringify(data);

      const statusLabel = parsedObj.status ?? "?";
      const timeLabel = parsedObj.total_time !== undefined && parsedObj.total_time !== null
        ? `${parsedObj.total_time}s`
        : "-";

      const shouldOffload = offload_large === true
        && bodyStr
        && Buffer.byteLength(bodyStr, "utf8") >= THRESHOLD_BYTES;

      if (shouldOffload && bodyStr) {
        const ct = extractContentType(parsedObj.headers) ?? "text/plain";
        const stored = await storePayload(bodyStr, ct, "response-body");
        const sizeKb = (stored.size / 1024).toFixed(1);
        return {
          content: [
            { type: "text", text: `${statusLabel} · offloaded ${sizeKb} KB · ${timeLabel}` },
            { type: "resource_link", uri: stored.uri, name: stored.name, mimeType: stored.mimeType },
          ],
          structuredContent: {
            status: parsedObj.status,
            headers: parsedObj.headers,
            total_time: parsedObj.total_time as string | number | null | undefined,
            offloaded_resource_uri: stored.uri,
            size_bytes: stored.size,
          },
        };
      }

      const sizeKb = bodyStr ? (Buffer.byteLength(bodyStr, "utf8") / 1024).toFixed(1) : "0";
      return {
        content: [{ type: "text", text: `${statusLabel} OK · ${sizeKb} KB · ${timeLabel}` }],
        structuredContent: parsedObj as Record<string, unknown>,
      };
    }),
  );
}

// Export helpers for unit and schema checks.
export const __test = { deriveCode, ResponseHeadersSchema, singleInputShape, singleOutputShape, guardHandler };
