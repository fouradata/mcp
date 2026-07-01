import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { withApiKey } from "./auth.js";
import { LANDING_REDIRECT, LLMS_TXT } from "./landing.js";

const PORT = Number(process.env.PORT ?? 3076);
const SERVER_VERSION = "0.3.3";

// Spec MUSTs covered in this file:
//   Origin + Host validation (CVE-2025-66414 DNS rebinding)
//   WWW-Authenticate on 401
//   MCP-Protocol-Version validation (delegated to SDK's list)
//   body size cap (256 KB)
//   server + request timeout
//   SIGTERM graceful shutdown

// MCP-Protocol-Version allowlist is DERIVED from the SDK at runtime, not
// hardcoded here. Reason: hardcoding froze us at 2025-06-18 / 2025-03-26
// and broke every newer client (Claude Code 2.1.141 sends 2025-11-25)
// until we shipped a release. By reading the SDK's exported authoritative
// list, every `npm update @modelcontextprotocol/sdk` automatically widens
// our supported set - no source-code change, no release coupling.
//
// SUPPORTED_PROTOCOL_VERSIONS for @modelcontextprotocol/sdk@1.29.0:
//   ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']

const RESOURCE_METADATA_URL =
  process.env.FOURA_MCP_RESOURCE_METADATA_URL ??
  "https://foura.ai/docs/api/mcp#auth";

function parseList(env: string | undefined, defaults: string[]): string[] {
  const raw = (env ?? "").trim();
  if (!raw) return defaults;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Default allowlist matches production deployment (mcp.foura.ai) +
// local development. Override with FOURA_MCP_ALLOWED_HOSTS / _ORIGINS for
// self-hosters or staging environments.
const ALLOWED_HOSTS = new Set(parseList(
  process.env.FOURA_MCP_ALLOWED_HOSTS,
  ["mcp.foura.ai", "localhost", "127.0.0.1", "[::1]"],
));
const ALLOWED_ORIGINS = new Set(parseList(
  process.env.FOURA_MCP_ALLOWED_ORIGINS,
  [
    "https://mcp.foura.ai",
    "https://claude.ai",
    "https://app.cursor.sh",
    "https://app.cursor.com",
  ],
));

const app = express();

// cap body size at 256 KB. Real MCP request payloads are <4 KB.
// Helps mitigate slow-body DoS + memory-exhaustion attacks.
app.use(express.json({ limit: "256kb" }));

// Origin + Host validation BEFORE the body is parsed for the MCP
// path. /healthz stays open so probes can hit it from any source.
function jsonRpcError(res: Response, status: number, code: number, message: string, extraHeaders?: Record<string, string>) {
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function validateOriginAndHost(req: Request, res: Response, next: NextFunction): void {
  // Host header - defends against DNS-rebinding (attacker's DNS resolves
  // their hostname to a loopback IP, but Host header carries their hostname).
  const hostHeader = (req.headers.host ?? "").toString();
  if (!hostHeader) {
    jsonRpcError(res, 403, -32000, "Missing Host header");
    return;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    jsonRpcError(res, 403, -32000, `Invalid Host header: ${hostHeader}`);
    return;
  }
  // For IPv6 the URL parser strips brackets; restore for the allowlist match.
  const normalizedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  if (!ALLOWED_HOSTS.has(hostname) && !ALLOWED_HOSTS.has(normalizedHost)) {
    jsonRpcError(res, 403, -32000, `Host ${hostname} is not in the allowlist`);
    return;
  }

  // Origin - browser-only; server-to-server callers (curl, MCP clients in
  // stdio bridge mode) omit it, which is per-spec acceptable. When PRESENT,
  // it MUST match the allowlist (prevents cross-origin JS from a malicious
  // page driving an authenticated MCP session).
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      jsonRpcError(res, 403, -32000, `Origin ${origin} is not in the allowlist`);
      return;
    }
  }

  next();
}

// MCP-Protocol-Version header validation. Allowlist comes from
// the SDK's authoritative `SUPPORTED_PROTOCOL_VERSIONS` export so we track
// upstream automatically. Per spec: when the header is absent, accept
// (backwards-compat). When present and unknown → 400 with the supported list
// in the error message so client implementations can self-diagnose.
function validateProtocolVersion(req: Request, res: Response, next: NextFunction): void {
  const raw = req.header("mcp-protocol-version");
  if (!raw) {
    next();
    return;
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(raw)) {
    jsonRpcError(
      res,
      400,
      -32602,
      `Unsupported MCP-Protocol-Version: ${raw}. Supported (from @modelcontextprotocol/sdk): ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}. Upgrade foura-mcp's SDK pin to extend.`,
    );
    return;
  }
  next();
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, name: "foura-mcp", version: SERVER_VERSION });
});

// Public discovery surfaces (no auth, no Origin/Host gate - like /healthz).
// The human landing lives at foura.ai/mcp, so a browser hitting the bare root
// is redirected there (301 = permanent, consolidates SEO onto the one page).
// llms.txt stays here: mcp.foura.ai is a separate host, so crawlers hitting
// mcp.foura.ai/llms.txt should find a map without following the redirect.
app.get("/", (_req, res) => {
  res.redirect(301, LANDING_REDIRECT);
});
app.get("/llms.txt", (_req, res) => {
  res.type("text/plain").send(LLMS_TXT);
});

function extractBearer(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const xKey = req.header("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

// emit WWW-Authenticate on 401 so clients can negotiate auth.
const WWW_AUTHENTICATE = `Bearer realm="foura-mcp", resource_metadata="${RESOURCE_METADATA_URL}"`;

app.post(
  "/mcp",
  validateOriginAndHost,
  validateProtocolVersion,
  async (req: Request, res: Response) => {
    const apiKey = extractBearer(req);
    if (!apiKey) {
      jsonRpcError(
        res,
        401,
        -32001,
        "Missing API key. Send 'Authorization: Bearer pk_live_...' with each request. " +
          "Get a key at https://foura.ai/dashboard#api-keys",
        { "WWW-Authenticate": WWW_AUTHENTICATE },
      );
      return;
    }

    try {
      const mcp = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on("close", () => {
        transport.close();
        mcp.close();
      });

      await mcp.connect(transport);
      await withApiKey(apiKey, () => transport.handleRequest(req, res, req.body));
    } catch (err) {
      console.error("[foura-mcp] /mcp handler error:", err);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  },
);

const methodNotAllowed = (_req: Request, res: Response) => {
  jsonRpcError(res, 405, -32000, "Method not allowed in stateless mode. Use POST /mcp.");
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.error(`[foura-mcp] HTTP listening on :${PORT}`);
});

// bound how long an incoming HTTP request can hold a socket open.
// Defends against slowloris-style attacks (open POST that never finishes
// sending the body).
server.setTimeout(60_000);
server.requestTimeout = 30_000;

// graceful shutdown. On SIGTERM, stop accepting new connections,
// let in-flight requests finish (up to 30s), then exit. docker-compose's
// stop_grace_period must be >= this hard cap.
function shutdown(signal: string): void {
  console.error(`[foura-mcp] received ${signal}, draining...`);
  server.close((err) => {
    if (err) {
      console.error("[foura-mcp] error during shutdown:", err);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[foura-mcp] shutdown grace period exceeded, forcing exit");
    process.exit(1);
  }, 30_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
