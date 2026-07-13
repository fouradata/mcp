import { request } from "undici";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApiKey } from "../auth.js";
import { assertPublicTarget, SsrfBlockedError } from "../safe-target.js";
import { storePayload, THRESHOLD_BYTES } from "../resources.js";

function extractContentTypeFromObject(headers: unknown): string | null {
  if (!headers || typeof headers !== "object") return null;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === "content-type") {
      const value = Array.isArray(v) ? v[0] : v;
      if (typeof value === "string") return value.split(";")[0]?.trim() ?? null;
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

const BROWSER_API_URL =
  (process.env.FOURA_API_BASE ?? "https://api.foura.ai/api") + "/browser/";

const BrowserCookieInputSchema = z.object({
  name: z.string().describe("Cookie name."),
  value: z.string().describe("Cookie value."),
  domain: z.string().optional().describe("Cookie domain (e.g. .example.com). Omit to scope it to the navigated URL's host."),
});

// Browser cookie fields vary by version, so the schema accepts additional properties.
const CdpCookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    size: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    session: z.boolean().optional(),
    sameSite: z.string().optional(),
  })
  .catchall(z.unknown());

const browserOutputShape = {
  // Success - the upstream response shape
  status: z.number().int().optional().describe("HTTP status code from the target page. `0` indicates the navigation failed before any HTTP response (DNS / connection refused / timeout) - check the `error` field for the underlying reason."),
  // Header values can be a string or an array of strings.
  headers: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Response headers as a flat key-value object. Values are typically strings but may be arrays for repeated headers."),
  // Browser output can contain either HTML text or parsed JSON.
  body: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe("Fully-rendered page content. String HTML when content-type is HTML; object when the page returned JSON and it was auto-parsed. Field is named `body`, not `data`. Omitted when offloaded."),
  cookies: z.array(CdpCookieSchema).optional().describe("Full cookie objects collected after navigation, including name, value, domain, path, expiry, and same-site settings."),
  userAgent: z.string().optional().describe("The User-Agent the browser session presented"),
  // Resource-link fields used when the response body is offloaded.
  offloaded_resource_uri: z.string().optional().describe("foura-mcp://payload/<uuid>. Pass this URI to resources/read to retrieve the offloaded body."),
  size_bytes: z.number().int().optional().describe("Total offloaded body size in bytes"),
  // Error path
  error: z.string().optional().describe("Human-readable error message"),
  service: z.enum(["single", "proxy", "browser", "api"]).optional(),
  retryAfter: z.number().optional(),
  current: z
    .object({ concurrency: z.number().optional(), rpm: z.number().optional() })
    .optional(),
  limits: z
    .object({ maxConcurrency: z.number().optional(), maxRpm: z.number().optional() })
    .optional(),
  code: z.string().optional().describe("Stable error code for retry classification. auth_failed means the FourA API key was rejected; verify that key, not target-site credentials. Other codes: ssrf_blocked, upstream_non_json, output_validation_failed, bad_request (400), forbidden (403), not_found (404), rate_limited (429), at_capacity (503), service_disabled (503), service_unavailable (503), upstream_error (>=500), upstream_client_error (other 4xx), upstream_unknown (defensive)."),
};

const browserInputShape = {
  url: z.string().url().describe("Public URL to load in a full browser session. Private or reserved targets return `ssrf_blocked`. Example: https://shop.example.com/product/123."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Custom HTTP headers as a key-value object rather than [name, value] tuples. Example: {\"Referer\": \"https://google.com/\"}"),
  cookies: z
    .array(BrowserCookieInputSchema)
    .optional()
    .describe("Cookies to set before navigation: [{ name, value, domain? }]"),
  userAgent: z.string().optional().describe("Override the browser's User-Agent string"),
  proxy: z
    .string()
    .optional()
    .describe(
      "Optional proxy. Three forms: (1) URL `http://user:pass@host:port` or `socks5://host:port`; " +
      "(2) base36 ID from foura_proxy (e.g. `4DZ3VE`) to reuse the same exit; " +
      "(3) omit to use the default route.",
    ),
  timeout_ms: z
    .number()
    .int()
    .min(0)
    .max(120_000)
    .optional()
    .describe("Page load timeout in ms (default 30000, max 120000)"),
  checkStatus: z
    .number()
    .int()
    .optional()
    .describe("Expected HTTP status code. A different status returns an error envelope carrying the actual value. Example: 200 for a product page."),
  checkText: z
    .string()
    .optional()
    .describe("Validate the rendered HTML once navigation completes. This is a substring check, not a waiter, and it doesn't poll. A missing substring returns an error envelope. Example: \"add to cart\" for a product page."),
  unblocker: z
    .boolean()
    .optional()
    .describe("Handle supported anti-bot or captcha challenges during navigation. Default true. Set false to return the page exactly as it loads, including any challenge page."),
  offload_large: z
    .boolean()
    .optional()
    .describe("If true, response bodies of 50 KB or more are returned as a resource_link instead of inlined. Default false. Read the returned offloaded_resource_uri with resources/read."),
};

export function registerBrowserTool(server: McpServer): void {
  server.registerTool(
    "foura_browser",
    {
      title: "FourA - full browser navigation",
      description:
        "Load a public URL in a full browser session. JavaScript runs, the DOM renders, and cookies " +
        "come back with the response. Use it for single-page apps, lazy-loaded content, or supported " +
        "browser challenges. For a protected page, call foura_proxy first and pass its returned " +
        "proxy ID here to reuse that exit. Set unblocker:false when you want the page exactly as it loads.",
      inputSchema: browserInputShape,
      outputSchema: browserOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => guardHandler("browser", z.object(browserOutputShape), async () => {
      try {
        await assertPublicTarget(input.url);
      } catch (e) {
        if (e instanceof SsrfBlockedError) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
            structuredContent: { service: "browser" as const, code: "ssrf_blocked", error: e.message },
          };
        }
        throw e;
      }

      const { offload_large, ...upstreamBody } = input;

      const res = await request(BROWSER_API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": getApiKey(),
          "Content-Type": "application/json",
          "User-Agent": "foura-mcp/0.5.0 (browser)",
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
              text: `FourA browser - non-JSON response (${res.statusCode}): ${text.slice(0, 200)}`,
            },
          ],
          structuredContent: {
            service: "browser" as const,
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
          content: [{ type: "text", text: `FourA browser error ${res.statusCode}: ${errMsg}${retryStr}` }],
          structuredContent: {
            ...e,
            service: "browser" as const,
            code: deriveCode(res.statusCode, e),
            status: typeof e.status === "number" ? e.status : res.statusCode,
          },
        };
      }

      const parsedObj = parsed as {
        body?: unknown;
        headers?: unknown;
        status?: number;
        cookies?: unknown;
        userAgent?: string;
        error?: unknown;
      };

      // A transport-200 response can still carry a navigation or validation error.
      if (typeof parsedObj.error === "string" && parsedObj.error.length > 0) {
        const innerStatus = typeof parsedObj.status === "number" ? parsedObj.status : 0;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `FourA browser - page failure (status ${innerStatus}): ${parsedObj.error}`,
            },
          ],
          structuredContent: {
            ...(parsedObj as Record<string, unknown>),
            service: "browser" as const,
            code: innerStatus > 0
              ? deriveCode(innerStatus, parsedObj as Record<string, unknown>)
              : "upstream_error",
            status: innerStatus,
          },
        };
      }

      const body = parsedObj.body;
      let bodyStr: string | null = null;
      if (typeof body === "string") bodyStr = body;
      else if (body && typeof body === "object") bodyStr = JSON.stringify(body);

      const statusLabel = parsedObj.status ?? "?";

      const shouldOffload = offload_large === true
        && bodyStr
        && Buffer.byteLength(bodyStr, "utf8") >= THRESHOLD_BYTES;

      if (shouldOffload && bodyStr) {
        const ct = extractContentTypeFromObject(parsedObj.headers) ?? "text/html";
        const stored = await storePayload(bodyStr, ct, "rendered-page.html");
        const sizeKb = (stored.size / 1024).toFixed(1);
        return {
          content: [
            { type: "text", text: `${statusLabel} · rendered ${sizeKb} KB offloaded` },
            { type: "resource_link", uri: stored.uri, name: stored.name, mimeType: stored.mimeType },
          ],
          structuredContent: {
            status: parsedObj.status,
            headers: parsedObj.headers as Record<string, unknown> | undefined,
            cookies: Array.isArray(parsedObj.cookies) ? parsedObj.cookies : undefined,
            userAgent: parsedObj.userAgent,
            offloaded_resource_uri: stored.uri,
            size_bytes: stored.size,
          },
        };
      }

      const sizeKb = bodyStr ? (Buffer.byteLength(bodyStr, "utf8") / 1024).toFixed(1) : "0";
      return {
        content: [{ type: "text", text: `${statusLabel} OK · ${sizeKb} KB rendered` }],
        structuredContent: parsedObj as Record<string, unknown>,
      };
    }),
  );
}

export const __test = { deriveCode, CdpCookieSchema, BrowserCookieInputSchema, browserInputShape, browserOutputShape };
