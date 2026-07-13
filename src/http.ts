import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { withApiKey } from "./auth.js";
import { LANDING_REDIRECT, LLMS_TXT } from "./landing.js";

const PORT = Number(process.env.PORT ?? 3076);
const SERVER_VERSION = "0.5.0";

// Read protocol versions from the SDK so client compatibility tracks dependency updates.

function parseList(env: string | undefined, defaults: string[]): string[] {
  const raw = (env ?? "").trim();
  if (!raw) return defaults;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Defaults cover the hosted endpoint and local development. Self-hosters can override them.
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

// Suppress Express's default response header.
app.disable("x-powered-by");

// Keep incoming MCP payloads bounded.
app.use(express.json({ limit: "256kb" }));

// Validate the MCP endpoint's Host and optional Origin headers.
function jsonRpcError(res: Response, status: number, code: number, message: string, extraHeaders?: Record<string, string>) {
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function validateOriginAndHost(req: Request, res: Response, next: NextFunction): void {
  // Match the request hostname against the configured list.
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

  // Browser requests include Origin; server-to-server clients can omit it.
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      jsonRpcError(res, 403, -32000, `Origin ${origin} is not in the allowlist`);
      return;
    }
  }

  next();
}

// Accept versions advertised by the installed SDK. The header is optional in the MCP spec.
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

// Keep public discovery on this host and send human visitors to the product page.
app.get("/", (_req, res) => {
  res.redirect(301, LANDING_REDIRECT);
});
app.get("/llms.txt", (_req, res) => {
  res.type("text/plain").send(LLMS_TXT);
});

function extractBearer(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth) {
    // Accept either a Bearer token or a bare key for clients that forward it unchanged.
    return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
  }
  const xKey = req.header("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

// Emit a minimal Bearer challenge so clients can send an API key.
const WWW_AUTHENTICATE = 'Bearer realm="foura-mcp"';

// Discovery is public. Tool execution and resource reads require an API key.
const KEY_REQUIRED_METHODS = new Set(["tools/call", "resources/read"]);

app.post(
  "/mcp",
  validateOriginAndHost,
  validateProtocolVersion,
  async (req: Request, res: Response) => {
    const apiKey = extractBearer(req);
    const calls = Array.isArray(req.body) ? req.body : [req.body];
    const needsKey = calls.some(
      (c) => c && typeof c.method === "string" && KEY_REQUIRED_METHODS.has(c.method),
    );
    if (needsKey && !apiKey) {
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
      await withApiKey(apiKey ?? "", () => transport.handleRequest(req, res, req.body));
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

// Bound the lifetime of incoming requests.
server.setTimeout(60_000);
server.requestTimeout = 30_000;

// Stop accepting new work, drain active requests, then exit.
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
