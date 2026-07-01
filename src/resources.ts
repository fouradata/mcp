import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApiKey } from "./auth.js";

/**
 * Resources - offload large response bodies (>= THRESHOLD bytes) onto host
 * disk and return a MCP resource_link instead of inlining megabytes into the
 * LLM context.
 *
 * Transport-level cross-cutting concern (same carve-out as auth.ts and
 * safe-target.ts). Per-tool product code stays per-file: each tool decides
 * which response field is the "large payload" (single/proxy use `data`,
 * browser uses `body`).
 *
 * tenant isolation. Payloads are stored under
 * `<PAYLOADS_DIR>/<keyhash>/<uuid>.{bin,meta.json}`, where `keyhash` is the
 * first 16 hex chars of sha256(apiKey). The resource handler validates the
 * caller's keyhash matches the storage path before serving - any other
 * tenant gets a `resource not found` (no leaking whether the UUID exists).
 */

export const THRESHOLD_BYTES = 50_000;

export const PAYLOADS_DIR =
  process.env.FOURA_MCP_PAYLOADS_DIR ?? path.join(tmpdir(), "foura-mcp-payloads");

const URI_PREFIX = "foura-mcp://payload/";

interface PayloadMeta {
  mimeType: string;
  originalName: string;
  size: number;
  storedAt: string;
  binary: boolean;
  keyhash: string;
}

export interface StoredPayload {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

// sha256(apiKey).hex().slice(0, 16) - gives 64 bits of namespacing entropy,
// short enough for a filesystem path component and unguessable for an
// attacker who doesn't have the corresponding API key.
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

const SAFE_UUID = /^[0-9a-f-]{36}$/i;
const SAFE_KEYHASH = /^[0-9a-f]{16}$/;

const tenantDirReady = new Set<string>();
async function ensureTenantDir(keyhash: string): Promise<string> {
  const dir = path.join(PAYLOADS_DIR, keyhash);
  if (!tenantDirReady.has(keyhash)) {
    await mkdir(dir, { recursive: true });
    tenantDirReady.add(keyhash);
  }
  return dir;
}

/**
 * Write `data` to disk under the caller's tenant namespace + return a
 * resource_link descriptor. Caller has already decided the payload is large
 * enough to offload (use THRESHOLD_BYTES for the size check).
 */
export async function storePayload(
  data: Buffer | string,
  mimeType: string,
  suggestedName: string,
): Promise<StoredPayload> {
  const keyhash = hashApiKey(getApiKey());
  const dir = await ensureTenantDir(keyhash);

  const uuid = randomUUID();
  const isBinary = Buffer.isBuffer(data);
  const buf = isBinary ? data : Buffer.from(data, "utf8");

  const dataPath = path.join(dir, `${uuid}.bin`);
  const metaPath = path.join(dir, `${uuid}.meta.json`);
  const meta: PayloadMeta = {
    mimeType,
    originalName: suggestedName,
    size: buf.byteLength,
    storedAt: new Date().toISOString(),
    binary: isBinary,
    keyhash,
  };

  await Promise.all([
    writeFile(dataPath, buf),
    writeFile(metaPath, JSON.stringify(meta), { encoding: "utf8" }),
  ]);

  return {
    uri: `${URI_PREFIX}${uuid}`,
    name: suggestedName,
    mimeType,
    size: buf.byteLength,
  };
}

export function registerResourceHandler(server: McpServer): void {
  server.registerResource(
    "payload",
    new ResourceTemplate(`${URI_PREFIX}{uuid}`, { list: undefined }),
    {
      title: "Cached foura-mcp response payload",
      description:
        "A large response body (>=50KB) returned by an earlier foura-mcp tool call, " +
        "stored on disk for follow-up reads instead of inlined into context. " +
        "Tenant-isolated: only the API key that stored the payload can read it back.",
    },
    async (uri, { uuid }) => {
      const uuidStr = Array.isArray(uuid) ? uuid[0] : uuid;
      if (!uuidStr || !SAFE_UUID.test(uuidStr)) {
        throw new Error(`Payload not found: ${uuidStr}`);
      }

      // Resolve the caller's tenant namespace and read ONLY from there.
      // Cross-tenant reads bubble up as plain ENOENT (don't leak existence).
      const keyhash = hashApiKey(getApiKey());
      if (!SAFE_KEYHASH.test(keyhash)) {
        throw new Error("Payload not found");
      }
      const dir = path.join(PAYLOADS_DIR, keyhash);
      const metaPath = path.join(dir, `${uuidStr}.meta.json`);
      const dataPath = path.join(dir, `${uuidStr}.bin`);

      let metaRaw: string;
      try {
        metaRaw = await readFile(metaPath, "utf8");
      } catch {
        throw new Error(`Payload not found: ${uuidStr}`);
      }
      const meta = JSON.parse(metaRaw) as PayloadMeta;
      // Defense in depth - even if filesystem permissions ever got bypassed,
      // the meta sidecar carries the keyhash; reject on mismatch.
      if (meta.keyhash !== keyhash) {
        throw new Error(`Payload not found: ${uuidStr}`);
      }
      const buf = await readFile(dataPath);

      return {
        contents: [
          meta.binary
            ? {
                uri: uri.href,
                mimeType: meta.mimeType,
                blob: buf.toString("base64"),
              }
            : {
                uri: uri.href,
                mimeType: meta.mimeType,
                text: buf.toString("utf8"),
              },
        ],
      };
    },
  );
}
