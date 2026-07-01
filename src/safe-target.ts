import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

/**
 * SSRF protection - refuse target URLs that resolve to private / reserved IPs.
 *
 * This is a TRANSPORT-LEVEL guard (same carve-out as auth.ts): protects the
 * forwarding path identically regardless of which endpoint is being called,
 * so it lives in one module and is imported by every tool. Per-endpoint
 * product code (schemas, paths, response parsing) remains fully duplicated.
 *
 * Pragmatic mode: we resolve once and verify, then forward the original
 * hostname to the upstream FourA API. The upstream resolves again seconds
 * later - a small TOCTOU window remains but catches all literal-IP and
 * ordinary-DNS attacks.
 */

interface V4Block {
  readonly base: number;
  readonly prefix: number;
}

function ipv4ToInt(addr: string): number {
  const parts = addr.split(".");
  if (parts.length !== 4) throw new Error(`bad IPv4: ${addr}`);
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`bad IPv4 octet: ${addr}`);
    n = n * 256 + v;
  }
  return n >>> 0;
}

// RFC 5735 + RFC 6598 (CGNAT) reserved IPv4 blocks.
const V4_RESERVED: ReadonlyArray<V4Block> = [
  { base: ipv4ToInt("0.0.0.0"),         prefix: 8  },   // "this network"
  { base: ipv4ToInt("10.0.0.0"),        prefix: 8  },   // RFC1918 private
  { base: ipv4ToInt("100.64.0.0"),      prefix: 10 },   // CGNAT (RFC 6598)
  { base: ipv4ToInt("127.0.0.0"),       prefix: 8  },   // loopback
  { base: ipv4ToInt("169.254.0.0"),     prefix: 16 },   // link-local
  { base: ipv4ToInt("172.16.0.0"),      prefix: 12 },   // RFC1918 private
  { base: ipv4ToInt("192.0.0.0"),       prefix: 24 },   // IETF protocol
  { base: ipv4ToInt("192.0.2.0"),       prefix: 24 },   // TEST-NET-1
  { base: ipv4ToInt("192.88.99.0"),     prefix: 24 },   // 6to4 anycast (deprecated)
  { base: ipv4ToInt("192.168.0.0"),     prefix: 16 },   // RFC1918 private
  { base: ipv4ToInt("198.18.0.0"),      prefix: 15 },   // benchmarking
  { base: ipv4ToInt("198.51.100.0"),    prefix: 24 },   // TEST-NET-2
  { base: ipv4ToInt("203.0.113.0"),     prefix: 24 },   // TEST-NET-3
  { base: ipv4ToInt("224.0.0.0"),       prefix: 4  },   // multicast
  { base: ipv4ToInt("240.0.0.0"),       prefix: 4  },   // reserved
  { base: ipv4ToInt("255.255.255.255"), prefix: 32 },   // broadcast
];

function isReservedV4(addr: string): boolean {
  let n: number;
  try {
    n = ipv4ToInt(addr);
  } catch {
    return false;
  }
  for (const b of V4_RESERVED) {
    const mask = b.prefix === 0 ? 0 : (0xffffffff << (32 - b.prefix)) >>> 0;
    if ((n & mask) === (b.base & mask)) return true;
  }
  return false;
}

function isReservedV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::" || a === "::1") return true;
  const firstGroup = a.split(":")[0] ?? "";
  // ULA fc00::/7 - first hex of first group is f, second is c or d
  if (/^f[cd][0-9a-f]{0,2}$/.test(firstGroup)) return true;
  // link-local fe80::/10 - first group starts fe8, fe9, fea, feb
  if (/^fe[89ab][0-9a-f]{0,1}$/.test(firstGroup)) return true;
  // documentation 2001:db8::/32
  if (/^2001:0?db8(:|$)/.test(a)) return true;
  // IPv4-mapped: ::ffff:x.x.x.x (dotted-quad form) - check embedded v4
  const v4mappedDotted = /^::ffff:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$/.exec(a);
  if (v4mappedDotted?.[1]) return isReservedV4(v4mappedDotted[1]);
  // IPv4-mapped canonical hex form (Node URL normalises ::ffff:192.168.1.1
  // to ::ffff:c0a8:101). Match ::ffff: prefix + two hex groups, decode.
  const v4mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (v4mappedHex) {
    const high = parseInt(v4mappedHex[1] ?? "0", 16);
    const low = parseInt(v4mappedHex[2] ?? "0", 16);
    const o1 = (high >> 8) & 0xff;
    const o2 = high & 0xff;
    const o3 = (low >> 8) & 0xff;
    const o4 = low & 0xff;
    return isReservedV4(`${o1}.${o2}.${o3}.${o4}`);
  }
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(public readonly hostInfo: string) {
    super(
      `Refusing to fetch ${hostInfo}: target resolves to a private or reserved IP range. ` +
        `The FourA scraping API only forwards requests to public internet hosts.`,
    );
    this.name = "SsrfBlockedError";
  }
}

export async function assertPublicTarget(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`unsupported scheme ${url.protocol}`);
  }

  // Strip the [...] brackets from a bare IPv6 hostname
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIPv4(host)) {
    if (isReservedV4(host)) throw new SsrfBlockedError(host);
    return;
  }
  if (isIPv6(host)) {
    if (isReservedV6(host)) throw new SsrfBlockedError(host);
    return;
  }

  let addrs: LookupAddress[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw new SsrfBlockedError(`DNS lookup failed for ${host}: ${(e as Error).message}`);
  }
  if (addrs.length === 0) {
    throw new SsrfBlockedError(`${host} resolved to no addresses`);
  }

  for (const a of addrs) {
    const bad = a.family === 4 ? isReservedV4(a.address) : isReservedV6(a.address);
    if (bad) throw new SsrfBlockedError(`${host} → ${a.address}`);
  }
}
