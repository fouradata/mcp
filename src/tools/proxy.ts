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
      .optional(),
    headers: z
      .object({
        accept: z
          .record(z.string(), z.string())
          .optional()
          .describe("Map of header-name-substring → header-value-substring (both case-insensitive). Response PASSES if AT LEAST ONE entry matches (header name contains the key AND value contains the value). Checked across all redirect hops. Empty / omitted = no header requirement."),
        fail: z
          .record(z.string(), z.string())
          .optional()
          .describe("Map of header-name-substring → header-value-substring (both case-insensitive). Response is treated as FAILURE if ANY entry matches a response header. Use to reject challenge / block headers, e.g. {\"x-blocked\": \"bot\", \"server\": \"cloudflare\"}."),
      })
      .optional(),
    data: z
      .object({
        accept: z.array(z.string()).optional(),
        fail: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .optional();

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
      .describe("Target URL the proxy should fetch. Public hosts only - private/reserved ranges (RFC 1918 + loopback + link-local + IPv6 ULA/loopback + *.local mDNS) are refused with code `ssrf_blocked`. Example: https://shop.example.com/pricing for blocked sites. {ts} placeholder is replaced with current Unix timestamp."),
    headers: z
      .array(z.tuple([z.string(), z.string()]))
      .optional()
      .describe("Custom HTTP headers as [name, value] tuples. Example: "),
    unblocker: z
      .boolean()
      .optional()
      .describe("Inject realistic browser headers (User-Agent, Sec-Ch-Ua, Accept-Encoding, …) and make the request look like it's coming from a real browser at the wire level. Default false - STRONGLY recommended on proxy paths since most sites that need a proxy also have wire-level anti-bot (Cloudflare, Akamai, PerimeterX, Datadome). Cheap to leave on for production scrapes."),
    data: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe("Request body."),
    timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Per-attempt timeout in ms"),
    connect_timeout_ms: z.number().int().min(0).max(120_000).optional(),
    accept_timeout_ms: z.number().int().min(0).max(120_000).optional(),
    server_response_timeout_ms: z.number().int().min(0).max(120_000).optional(),
    dns_cache_timeout_sec: z.number().int().min(0).max(240).optional(),
    followRedirects: z.number().int().min(0).max(20).optional().describe("Max number of redirects to follow (0-20). Omit to disable redirect following."),
    tryJsonData: z.boolean().optional(),
    returnBuffer: z.boolean().optional(),
    validate: ProxyValidateSchema,
  })
  .describe(
    "The inner HTTP request to send through each proxy attempt. Validation rules here determine when a proxy is treated as failed and retried.",
  );

// the header array - same as single. Multi-value headers (Set-Cookie, Link)
// come as string OR string[] from the HTTP engine.
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
  // also has an optional `proxyId` (number), but the api gateway encodes it
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
      "Base36 ID of the pool exit that succeeded (e.g. `4DZ3VE`). Reuse on next call: " +
      "pass to foura_single.proxy or foura_browser.proxy → same exit IP. " +
      "Pass to foura_proxy.ignoreProxies → skip this exit on future rotations.",
    ),
  total: z
    .number()
    .optional()
    .describe("Outer total time in seconds (proxy selection + retries + the successful inner attempt). Float."),
  // Offload path - MCP layer adds these when body >= 50KB AND offload_large=true
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>"),
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
  code: z.string().optional().describe("Stable error code for retry classification. One of: ssrf_blocked, upstream_non_json, output_validation_failed, bad_request (400), auth_failed (401), forbidden (403), not_found (404), rate_limited (429), at_capacity (503), service_disabled (503), service_unavailable (503), upstream_error (>=500), upstream_client_error (other 4xx), upstream_unknown (defensive)."),
};

const proxyInputShape = {
  request: ProxyInnerRequestSchema,
  // PrRequestSchema.timeout_ms is `.positive()` in upstream - 0 is invalid here
  // (different from single's .min(0)).
  maxTries: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("Maximum proxy rotation attempts before giving up (default 5, max 90). Default 5 is sized for lightly-blocked sites. Raise to 25-30 for tier-1 WAF challenges (Vercel Security Checkpoint, Cloudflare 'Just a moment', Akamai Bot Manager) - most rotations on these targets need this range. If still blocked after 30 attempts, the gate is likely country / ASN allowlist (not solvable by rotation) - pivot strategy instead of climbing to 60."),
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
    .describe("Encoded proxy IDs (base36 strings like \"4DZ3VE\") OR proxy URLs to exclude from rotation. Both forms are accepted."),
  //  fix - opt-in offload, default false (inline).
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies >= 50KB are written to disk and returned as a resource_link instead of inlined. Default false."),
};

export function registerProxyTool(server: McpServer): void {
  server.registerTool(
    "foura_proxy",
    {
      title: "FourA - HTTP request via rotating proxies",
      description:
        "Route an HTTP request through FourA's proxy pool with automatic retry across multiple proxies. " +
        "Per-host proxy rating picks proxies most likely to succeed for the target. Use when foura_single " +
        "returns 403, captcha, or geo-blocked content. Typical latency 1-5s. The response includes the " +
        "encoded proxy ID that succeeded ('proxy' field) - reuse it in foura_single.proxy or " +
        "foura_browser.proxy to pin follow-up requests to the same exit IP, or pass it in ignoreProxies " +
        "to skip this exit on the next rotation. Escalate to foura_browser if all proxies fail or the " +
        "page needs JavaScript rendering. When the trigger is a tier-1 WAF challenge (Vercel Security " +
        "Checkpoint, Cloudflare 'Just a moment', Akamai Bot Manager), set maxTries to 25-30 - the default " +
        "5 will usually be too low for these targets. Distinguish from country / ASN allowlist denials " +
        "(country-licensed bookmakers, government sites): there rotation never helps regardless of " +
        "maxTries - after ~30 failed attempts on the same block, stop climbing and pivot strategy instead.",
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
          "User-Agent": "foura-mcp/0.4.2 (proxy)",
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
        error?: unknown;
        request?: unknown;
      };

      //  fix - all-proxies-fail returns HTTP 200 + PrResponseError shape
      // {error, request, total}. the upstream API proxy/src/api/request.ts:43
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
            code: innerStatus > 0
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

      const shouldOffload = offload_large === true
        && bodyStr
        && Buffer.byteLength(bodyStr, "utf8") >= THRESHOLD_BYTES;

      if (shouldOffload && bodyStr) {
        const ct = extractContentType(parsedObj.headers) ?? "text/plain";
        const stored = await storePayload(bodyStr, ct, "response-body");
        const sizeKb = (stored.size / 1024).toFixed(1);
        return {
          content: [
            { type: "text", text: `${statusLabel} · offloaded ${sizeKb} KB${proxyLabel}` },
            { type: "resource_link", uri: stored.uri, name: stored.name, mimeType: stored.mimeType },
          ],
          structuredContent: {
            status: parsedObj.status,
            headers: parsedObj.headers,
            total_time: parsedObj.total_time as string | number | null | undefined,
            proxy: parsedObj.proxy,
            total: parsedObj.total,
            offloaded_resource_uri: stored.uri,
            size_bytes: stored.size,
          },
        };
      }

      const sizeKb = bodyStr ? (Buffer.byteLength(bodyStr, "utf8") / 1024).toFixed(1) : "0";
      return {
        content: [{ type: "text", text: `${statusLabel} OK · ${sizeKb} KB${proxyLabel}` }],
        structuredContent: parsedObj as Record<string, unknown>,
      };
    }),
  );
}

export const __test = { deriveCode, ProxyResponseHeadersSchema, ProxyInnerRequestSchema, proxyInputShape, proxyOutputShape };
