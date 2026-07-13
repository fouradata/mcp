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

const PROXY_API_URL =
  (process.env.FOURA_API_BASE ?? "https://api.foura.ai/api") + "/proxy/";

const ProxyValidateSchema = z
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
        accept: z.array(z.string()).optional().describe("Substrings the response body must contain to pass."),
        fail: z.array(z.string()).optional().describe("Substrings that, if present in the body, mark the response as failed."),
      })
      .optional()
      .describe("Body validation: pass when the body contains an expected substring (accept), fail when it contains a blocked one (fail)."),
  })
  .optional()
  .describe("Per-attempt response validation. A proxy attempt that fails these checks is treated as failed and the next proxy is tried.");

// Inner DwRequest - matches the upstream API types/src/single.ts DwRequestSchema
// (which is what /api/proxy/ inner.request validates against). Method is
// permissive z.string() not enum . All optionals match upstream.
const ProxyInnerRequestSchema = z
  .object({
    method: z
      .string()
      .min(1)
      .describe("HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or any WebDAV verb)"),
    url: z
      .string()
      .url()
      .describe("Public target URL. Private or reserved targets return `ssrf_blocked`. Use {ts} in the URL to insert the current Unix timestamp. Example: https://shop.example.com/pricing."),
    headers: z
      .array(z.tuple([z.string(), z.string()]))
      .optional()
      .describe("Custom HTTP headers as [name, value] tuples. Example: [[\"Accept\", \"application/json\"]]"),
    unblocker: z
      .boolean()
      .optional()
      .describe("Add common browser headers such as User-Agent, Sec-Ch-Ua, and Accept-Encoding. Default false. Enable it for targets that reject basic HTTP requests."),
    data: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe("Request body."),
    timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Per-attempt timeout in ms"),
    connect_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms for establishing the connection to the target through the proxy (0-120000). Omit for the default."),
    accept_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms to receive the first response byte after the request is sent (0-120000). Omit for the default."),
    server_response_timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Timeout in ms for the server to send the complete response (0-120000). Omit for the default."),
    dns_cache_timeout_sec: z.number().int().min(0).max(240).optional().describe("How long (seconds) to cache the target's resolved DNS (0-240). Omit for the default."),
    followRedirects: z.number().int().min(0).max(20).optional().describe("Max number of redirects to follow (0-20). Omit to disable redirect following."),
    tryJsonData: z.boolean().optional().describe("If true, attempt JSON.parse on the response body; on success `data` is the parsed value, otherwise it stays the original string. Omit to keep the body as-is."),
    returnBuffer: z.boolean().optional().describe("Return raw bytes as a serialized Buffer JSON shape ({type:\"Buffer\", data:[byte, ...]}) instead of a decoded string. Use for binary responses (images, protobuf)."),
    validate: ProxyValidateSchema,
  })
  .describe(
    "The inner HTTP request to send through each proxy attempt. Validation rules here determine when a proxy is treated as failed and retried.",
  );

// the header array - same as single. Multi-value headers (Set-Cookie, Link)
// can be a string or an array of strings.
const ProxyResponseHeadersSchema = z
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

const proxyOutputShape = {
  // Success - PrResponse = DwResponse + {proxy, total}. The backend type
  // also has an optional `proxyId` (number), but the public API encodes it
  // into the `proxy` string and strips it from the response. We don't
  // surface it in outputSchema - zod silently drops any stray copy.
  status: z.number().int().optional().describe("HTTP status code from the target (from the succeeding proxy attempt). `0` indicates every attempt failed before any HTTP response (DNS / connection refused / timeout) - check the `error` field for the underlying reason."),
  headers: z
    .union([z.array(ProxyResponseHeadersSchema), z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Response headers per redirect hop, as an array of objects. Each entry has `result.{version, code, reason}` plus arbitrary header-name keys whose values are strings (or arrays of strings for multi-value headers like Set-Cookie / Link)."),
  data: z.unknown().optional().describe("Decoded response body. Omitted when offloaded."),
  // total_time can be string | number | null per the upstream API types.
  total_time: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe("Per-attempt wall-clock duration of the succeeding inner request"),
  proxy: z
    .string()
    .optional()
    .describe(
      "Base36 ID of the exit that succeeded (e.g. `4DZ3VE`). Pass it to " +
      "foura_single.proxy or foura_browser.proxy to reuse that exit, or to " +
      "foura_proxy.ignoreProxies to skip it on future rotations.",
    ),
  exitCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe("Latest available two-letter target-visible exit-country code used for selection. Present on successful requests that use exitCountries."),
  total: z
    .number()
    .optional()
    .describe("Outer total time in seconds (proxy selection + retries + the successful inner attempt). Float."),
  // Offload path - MCP layer adds these when body >= 50KB AND offload_large=true
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>. Pass this URI to resources/read to retrieve the offloaded body."),
  size_bytes: z.number().int().optional().describe("Total offloaded body size in bytes"),
  // Error path - includes PrResponseError shape: {error, request, total} (no status, no headers, no data)
  error: z.string().optional().describe("Human-readable error message"),
  service: z.enum(["single", "proxy", "browser", "api"]).optional(),
  retryAfter: z.number().optional(),
  current: z
    .object({ concurrency: z.number().optional(), rpm: z.number().optional() })
    .optional(),
  limits: z
    .object({ maxConcurrency: z.number().optional(), maxRpm: z.number().optional() })
    .optional(),
  request: z.unknown().optional().describe("Echoed PrRequest from upstream PrResponseError"),
  details: z
    .object({
      exitCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
    })
    .optional()
    .describe("Structured no_eligible_proxy context containing the normalized requested country scope. Preserve this scope unless the user explicitly changes the requirement."),
  code: z.string().optional().describe("Stable error code for retry classification. no_eligible_proxy means the strict exitCountries scope had no match; retrying without that scope requires an explicit user decision."),
};

const proxyInputShape = {
  request: ProxyInnerRequestSchema,
  // Unlike foura_single, this timeout must be positive.
  maxTries: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("Maximum rotation attempts before giving up (default 5, max 90). Difficult protected targets may need 25-30. Use exitCountries for country scope."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Overall timeout across all rotation attempts in ms (default 45000, max 120000). Must be positive."),
  ignoreProxies: z
    .array(z.string())
    .optional()
    .describe("Encoded proxy IDs (base36 strings like \"4DZ3VE\") or proxy URLs to exclude from rotation."),
  exitCountries: z
    .array(
      z.string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, "Expected a two-letter exit-country code"),
    )
    .min(1)
    .transform((countries) => [...new Set(countries)])
    .optional()
    .describe("Optional target-visible proxy countries as two-letter provider codes, for example [\"CZ\", \"GB\"]. Values are trimmed, uppercased, and deduplicated. Unknown exits are excluded and the request never falls back to another country."),
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies of 50 KB or more are returned as a resource_link instead of inlined. Default false. Read the returned offloaded_resource_uri with resources/read."),
};

export function registerProxyTool(server: McpServer): void {
  server.registerTool(
    "foura_proxy",
    {
      title: "FourA - HTTP request via rotating proxies",
      description:
        "Route an HTTP request through rotating proxies with automatic retry. Use it when foura_single " +
        "is blocked or the target requires a specific exit country. The response includes the proxy ID " +
        "that succeeded; reuse it with foura_single or foura_browser, or exclude it with ignoreProxies. " +
        "Use foura_browser when the page needs JavaScript. Set exitCountries for a strict country allowlist.",
      inputSchema: proxyInputShape,
      outputSchema: proxyOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => guardHandler("proxy", z.object(proxyOutputShape), async () => {
      try {
        await assertPublicTarget(input.request.url);
      } catch (e) {
        if (e instanceof SsrfBlockedError) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
            structuredContent: { service: "proxy" as const, code: "ssrf_blocked", error: e.message },
          };
        }
        throw e;
      }

      const { offload_large, ...upstreamBody } = input;

      const res = await request(PROXY_API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": getApiKey(),
          "Content-Type": "application/json",
          "User-Agent": "foura-mcp/0.5.0 (proxy)",
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
              text: `FourA proxy - non-JSON response (${res.statusCode}): ${text.slice(0, 200)}`,
            },
          ],
          structuredContent: {
            service: "proxy" as const,
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
          content: [{ type: "text", text: `FourA proxy error ${res.statusCode}: ${errMsg}${retryStr}` }],
          structuredContent: {
            ...e,
            service: "proxy" as const,
            code: deriveCode(res.statusCode, e),
            status: typeof e.status === "number" ? e.status : res.statusCode,
          },
        };
      }

      const parsedObj = parsed as {
        data?: unknown;
        headers?: unknown;
        status?: number;
        total_time?: unknown;
        total?: number;
        proxy?: string;
        exitCountry?: string;
        error?: unknown;
        code?: unknown;
        request?: unknown;
      };

      // A transport-200 response can still represent a failed rotation.
      // forwards without overriding the response status. Without this check,
      // foura-mcp would silently return "success" with a missing-data body.
      if (typeof parsedObj.error === "string" && parsedObj.error.length > 0) {
        const innerStatus = typeof parsedObj.status === "number" ? parsedObj.status : 0;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `FourA proxy - all attempts failed: ${parsedObj.error}`,
            },
          ],
          structuredContent: {
            ...(parsedObj as Record<string, unknown>),
            service: "proxy" as const,
            code: typeof parsedObj.code === "string"
              ? parsedObj.code
              : innerStatus > 0
                ? deriveCode(innerStatus, parsedObj as Record<string, unknown>)
                : "upstream_error",
            status: innerStatus,
          },
        };
      }

      const data = parsedObj.data;
      let bodyStr: string | null = null;
      if (typeof data === "string") bodyStr = data;
      else if (data && typeof data === "object") bodyStr = JSON.stringify(data);

      const statusLabel = parsedObj.status ?? "?";
      const proxyLabel = parsedObj.proxy ? ` · via ${parsedObj.proxy}` : "";
      const countryLabel = parsedObj.exitCountry ? ` · exit ${parsedObj.exitCountry}` : "";

      const shouldOffload = offload_large === true
        && bodyStr
        && Buffer.byteLength(bodyStr, "utf8") >= THRESHOLD_BYTES;

      if (shouldOffload && bodyStr) {
        const ct = extractContentType(parsedObj.headers) ?? "text/plain";
        const stored = await storePayload(bodyStr, ct, "response-body");
        const sizeKb = (stored.size / 1024).toFixed(1);
        return {
          content: [
            { type: "text", text: `${statusLabel} · offloaded ${sizeKb} KB${proxyLabel}${countryLabel}` },
            { type: "resource_link", uri: stored.uri, name: stored.name, mimeType: stored.mimeType },
          ],
          structuredContent: {
            status: parsedObj.status,
            headers: parsedObj.headers,
            total_time: parsedObj.total_time as string | number | null | undefined,
            proxy: parsedObj.proxy,
            exitCountry: parsedObj.exitCountry,
            total: parsedObj.total,
            offloaded_resource_uri: stored.uri,
            size_bytes: stored.size,
          },
        };
      }

      const sizeKb = bodyStr ? (Buffer.byteLength(bodyStr, "utf8") / 1024).toFixed(1) : "0";
      return {
        content: [{ type: "text", text: `${statusLabel} OK · ${sizeKb} KB${proxyLabel}${countryLabel}` }],
        structuredContent: parsedObj as Record<string, unknown>,
      };
    }),
  );
}

export const __test = { deriveCode, ProxyResponseHeadersSchema, ProxyInnerRequestSchema, proxyInputShape, proxyOutputShape };
