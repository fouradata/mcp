<!-- mcp-name: ai.foura/mcp -->
# @fouradata/mcp

[![npm version](https://img.shields.io/npm/v/@fouradata/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@fouradata/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@fouradata/mcp?color=cb3837)](https://www.npmjs.com/package/@fouradata/mcp)
[![provenance signed](https://img.shields.io/badge/supply_chain-provenance_signed-2ea44f?logo=npm)](https://www.npmjs.com/package/@fouradata/mcp)
[![license MIT](https://img.shields.io/npm/l/@fouradata/mcp?color=2ea44f)](./LICENSE)
[![smithery badge](https://smithery.ai/badge/foura/mcp)](https://smithery.ai/servers/foura/mcp)

[FourA Web Scraping API](https://foura.ai/) as four [Model Context Protocol](https://modelcontextprotocol.io) tools plus six built-in workflow prompts. Plug it into Claude Desktop, Claude Code, Cursor, Windsurf, or any other MCP client and fetch arbitrary public web pages, bypass anti-bot challenges, and render JavaScript-heavy sites - without writing a line of integration code.

Four tools, six prompts, one API key. One smart `foura_auto` tool picks the fetch method for you (direct, proxy, or full browser); drop to the primitives when you want explicit control. Published to npm with build [provenance](https://docs.npmjs.com/generating-provenance-statements) - the tarball is cryptographically traceable to this repo and CI run.

**One-click install:**

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=foura&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3VyYWRhdGEvbWNwIl0sImVudiI6eyJGT1VSQV9BUElfS0VZIjoiWU9VUl9GT1VSQV9BUElfS0VZIn19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522foura%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540fouradata%252Fmcp%2522%255D%252C%2522env%2522%253A%257B%2522FOURA_API_KEY%2522%253A%2522YOUR_FOURA_API_KEY%2522%257D%257D)

Both buttons pre-fill the config with a `YOUR_FOURA_API_KEY` placeholder - replace it with your key. Or by hand: `claude mcp add foura -- npx -y @fouradata/mcp` (set `FOURA_API_KEY` in env first). Full per-client setup below.

[FourA](https://foura.ai) - [MCP page](https://foura.ai/mcp) - [GitHub](https://github.com/fouradata/mcp) - [npm](https://www.npmjs.com/package/@fouradata/mcp) - [Docs](https://foura.ai/docs/mcp/server) - [Hosted endpoint](https://mcp.foura.ai/mcp)

## Quick Start - local stdio (recommended for Claude Desktop)

Grab a key at [foura.ai/dashboard/#api-keys](https://foura.ai/dashboard/#api-keys) (one click, shown once on creation, format `pk_live_...`). Then drop this into your MCP client's config:

```json
{
  "mcpServers": {
    "foura": {
      "command": "npx",
      "args": ["-y", "@fouradata/mcp"],
      "env": {
        "FOURA_API_KEY": "pk_live_..."
      }
    }
  }
}
```

> **Claude Desktop gotcha:** fully quit Claude Desktop (`Cmd+Q` on macOS) **before** editing the config file. If the app is still running, it will overwrite your edits with its in-memory config on exit.

The npx command downloads the package on first launch (~10s) and runs it as a subprocess of your MCP client. No global install needed. Same JSON works in every major client - just point it at the right file:

| Client | Where the config lives |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `claude mcp add foura -- npx -y @fouradata/mcp` (set `FOURA_API_KEY` in env first) |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (MCP extension) | `.vscode/mcp.json` in your workspace |

Restart the client and `foura_auto`, `foura_single`, `foura_proxy`, `foura_browser` show up in your tool list, plus six prompts under `/prompts`.

## Quick Start - hosted (Streamable HTTP)

For clients that support the Streamable HTTP transport (Cursor, Windsurf, VS Code, Claude Code with `--transport http`), point them at the hosted endpoint instead of running a local subprocess:

```json
{
  "mcpServers": {
    "foura": {
      "url": "https://mcp.foura.ai/mcp",
      "headers": {
        "Authorization": "Bearer pk_live_..."
      }
    }
  }
}
```

Current Claude Desktop builds reject the bare `url` form - use the stdio config above for Claude Desktop, or bridge through `mcp-remote`:

```json
{
  "mcpServers": {
    "foura": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.foura.ai/mcp", "--header", "Authorization: Bearer pk_live_..."]
    }
  }
}
```

## The Tools

`foura_auto` is the **default** - give it a URL and it returns the content, picking the fetch method for you. The other three are the lower-level primitives it orchestrates; reach for them when you want explicit control.

All four are marked `readOnlyHint: true` and `openWorldHint: true` per the [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) - clients that auto-approve trusted read-only tools (Claude Desktop, Cursor in 2026) call them without a per-request confirmation modal.

Every response carries both human-readable text (`content`) and a typed `structuredContent` JSON object validated against the tool's `outputSchema`. Clients pass `structuredContent` to your LLM natively, skipping the re-tokenization tax on stringified JSON.

### `foura_auto` - smart fetch (the default)

Give a URL, get the content back. Use this first when you just want the page and don't want to choose a method. Internally it walks a cost-aware ladder - a fast direct request, then a rotating proxy, then a full browser session - escalating only as far as the target forces it, solving common bot challenges on the way, and cheaply replaying a warm session on repeat calls to the same host. It learns the right settings per host, so there are no `maxTries` / pool / retry knobs to tune.

```jsonc
{
  "url": "https://example.com",
  // optional: a substring the REAL page must contain, so auto can tell a
  // real page from a challenge page on protected targets
  "validate": { "data": { "accept": ["Example Domain"] } }
}
```

The client surface is intentionally minimal: `url` (required), plus optional `method`, `headers`, `data`, `validate`, `returnSession` (default `true`), `forceProxy` (default `true`), `timeout_ms` (5000-180000, default 120000), `ignoreProxies`.

`structuredContent` shape: `{status, headers, data, meta, session}`. `meta` is always present - `{rung, solved, attempts, credits}` - the trace of which rung delivered and what it cost. `session` (`{proxy, cookies, userAgent}`) is returned by default so you can replay the same session through `foura_single` / `foura_proxy` afterwards (pass `session.proxy` into their `proxy` field). Send `returnSession: false` to omit it. There is no `total_time` field on auto.

### `foura_single` - fast HTTP

One HTTP request, response back. Typically 200ms-2s. Use it for static pages, JSON APIs, server-rendered HTML - the bread and butter of scraping. Set `unblocker: true` if the target is picky about wire-level signals.

```jsonc
{
  "method": "GET",
  "url": "https://example.com",
  "unblocker": true
}
```

Supports custom headers, a body, per-stage timeouts, redirect controls, JSON auto-parse, a binary-buffer mode, and built-in response validation (`validate.status.accept`, `validate.data.fail`, and so on). If `foura_single` comes back blocked - status 403/429, captcha page, OR response headers `x-vercel-mitigated: challenge` / `cf-mitigated: challenge`, OR body title matches `Vercel Security Checkpoint` / `Just a moment` / `Attention Required` - escalate to `foura_proxy` with `maxTries: 25-30` for these tier-1 WAFs. If the page also needs JavaScript to render, chain `foura_proxy`'s returned `proxy` ID into `foura_browser.proxy`.

`structuredContent` shape: `{status, headers, data, total_time, ...}`.

### `foura_proxy` - rotating proxies with retry

Same target shape as `foura_single`, but routed through a pool of proxies with automatic retry on failure. Per-host scoring picks the proxies most likely to succeed against this particular target, so you're not burning attempts on known-bad routes.

```jsonc
{
  "maxTries": 5,
  "exitCountries": ["CZ", "GB"],
  "request": {
    "method": "GET",
    "url": "https://example.com/pricing",
    "unblocker": true
  }
}
```

Typical latency is 1-5s. `structuredContent` adds `proxy` (the encoded ID of the proxy that succeeded) and `total` (outer timing including selection and retries). `exitCountries` is optional: values are trimmed, uppercased, and deduplicated; proxies with unknown exits are excluded; the request never falls back to an unrequested country. Selection uses the latest country metadata synced from the proxy pool, normally refreshed within ten minutes, and a scoped success returns that value as `exitCountry`. If no locally synced proxy matches, the result uses `code: "no_eligible_proxy"`.

For tier-1 WAF challenges (Vercel Security Checkpoint, Cloudflare 'Just a moment', Akamai Bot Manager), use `maxTries: 25-30`. For a country allowlist, set `exitCountries` instead of increasing attempts. An ASN-only denial is a separate constraint. If the target needs JavaScript rendering, chain the returned `proxy` ID into `foura_browser.proxy`.

### `foura_browser` - full browser session

A real browser session. JavaScript runs, the DOM finishes rendering, cookies come back with the response. Use it when the page is a single-page app, when content lazy-loads after first paint, or when there's an anti-bot challenge that needs a real browser to clear.

```jsonc
{
  "url": "https://example.com/spa",
  "timeout_ms": 15000,
  "checkText": "data-table"
}
```

Slowest of the lower-level tools (2-10s) but the only tool that handles JavaScript end-to-end. `checkText` is a one-shot post-render validator (substring search on the rendered HTML AFTER navigation completes - not a waiter, does not poll): if the substring is missing, the call fails with an error envelope. Useful when a page returns 200 but the actual content is missing. `unblocker` defaults to `true` - the session actively solves an anti-bot / captcha challenge (Cloudflare Turnstile and similar) it meets along the way; set `unblocker: false` to render and return the page exactly as it loads, challenge page included.

`structuredContent` shape is intentionally different from single/proxy: `{status, headers (object, not array), body (not data), cookies (full browser cookie shape), userAgent}`.

## Built-in Prompts

Six workflow templates surfaced under `/prompts` in your MCP client. They orchestrate one or more tools without you spelling out the steps.

| Prompt | Arguments | What it does |
|---|---|---|
| `smart_fetch` | `url, must_contain?, extract?` | Auto fetch (picks the method, handles bot protection) → return or extract content |
| `scrape_product_page` | `url` | Browser fetch → extract title, price, image, stock, SKU as JSON |
| `extract_article` | `url` | Single → fallback to proxy → strip nav/ads → return clean article JSON |
| `monitor_pricing` | `url, target_price?` | Proxy fetch → extract price → compare to target |
| `check_endpoint_health` | `url, expected_text?` | Single with strict validation → reachable/status/timing report |
| `bulk_fetch_urls` | `urls` (comma-separated) | Parallel single → auto-fallback to proxy per URL → metadata only |

Each prompt arrives as a templated user message your LLM executes with the right tools. They cost zero tokens at idle - only invoked prompts enter the context window.

Full recipe text + manual fallback prompts: [foura.ai/docs/mcp/recipes](https://foura.ai/docs/mcp/recipes). For the full error code list, see [foura.ai/docs/mcp/errors](https://foura.ai/docs/mcp/errors).

## Authentication

Your `Bearer` token (or the `FOURA_API_KEY` env var in stdio mode) forwards to the FourA API as `X-API-Key`. One key, all four tools.

Keys are managed in the [dashboard](https://foura.ai/dashboard/#api-keys) - shown once on creation, rotate or deactivate any time. See [foura.ai/docs/getting-started/authentication](https://foura.ai/docs/getting-started/authentication) for the full key-management walkthrough.

## Error envelope - typed contract for agent retries

Every error (`isError: true`) carries a `structuredContent` envelope with at minimum these three fields:

```jsonc
{
  "service": "single" | "proxy" | "browser",
  "code": "ssrf_blocked" | "auth_failed" | "rate_limited" | ...,
  "error": "Human-readable message"
}
```

Where the upstream returned a status, you also get `status` (HTTP code) and on rate-limit / capacity errors the FourA API envelope adds `retryAfter`, `current.{concurrency, rpm}`, `limits.{maxConcurrency, maxRpm}`.

| `code` | When | Retry safe? |
|---|---|---|
| `ssrf_blocked` | Target IP in a private / reserved range (RFC 5735+6598+IPv6 reserved) | No - change the URL |
| `upstream_non_json` | Upstream returned malformed body | Maybe - investigate |
| `bad_request` (400) | Input shape rejected by FourA | No - fix arguments |
| `auth_failed` (401) | Key missing, invalid, or deactivated | No - fix the key |
| `forbidden` (403) | Authenticated but not allowed | No |
| `not_found` (404) | Target / endpoint doesn't exist | No |
| `rate_limited` (429) | RPM cap hit | Yes - wait `retryAfter` |
| `at_capacity` (503) | Concurrency cap hit | Yes - wait `retryAfter` |
| `service_disabled` (503) | Maintenance window | Yes - wait `retryAfter` |
| `service_unavailable` (503) | Generic 503 | Yes - short backoff |
| `upstream_error` (≥500) | Upstream 5xx | Yes - exponential backoff |
| `upstream_client_error` (4xx) | Other 4xx | Usually no |

LLM agents can read `code` directly for retry logic without parsing prose. Spec reference: [foura.ai/docs/api/errors](https://foura.ai/docs/api/errors).

## Combining the tools - sticky exit IPs

The lower-level tools compose. `foura_proxy` returns the base36 ID of the exit it used. Pass that ID back into `foura_single.proxy` or `foura_browser.proxy` and the next call exits through the **same IP** - same session, same fingerprint, same geo.

```jsonc
// 1. Find a working exit for the target - use maxTries:25-30 for tier-1 WAFs
const r = await foura_proxy({
  maxTries: 30,
  request: { method: "GET", url: "https://probe.example.com", unblocker: true }
});
// → { status: 200, proxy: "4DZ3VE", ... }

// 2. Reuse it for follow-up HTTP (cookies, multi-step flows)
await foura_single({ method: "GET", url: "https://target/api", proxy: r.proxy });

// 3. Or render JS through the same egress - exits through the IP that already
//    cleared the challenge for this target, so the snapshot captures the real
//    post-challenge content instead of a challenge page.
await foura_browser({ url: "https://target/spa", proxy: r.proxy });
```

This chain is the canonical pattern for **tier-1 WAF + JavaScript-rendered targets** (Vercel Security Checkpoint, Cloudflare 'Just a moment', Akamai Bot Manager protecting SPAs). Calling `foura_browser` directly against a WAF target usually captures the challenge page - the snapshot fires before the challenge's deferred reload completes. Solve via `foura_proxy` first, then chain.

To rotate AWAY from a known-bad proxy on the next `foura_proxy` call, pass it as `ignoreProxies: ["4DZ3VE"]`. The `proxy` field on `foura_single` and `foura_browser` also accepts raw URLs (`http://host:port`, `socks5://...`) if you have your own list.

## Large responses - `offload_large` (default: inline)

By default (since v0.2.0), full response bodies are returned inline in `structuredContent` regardless of size. This works in every MCP client.

If your client supports MCP `resources/read` (and you want to save tokens on big pages), pass `offload_large: true` per tool call. Responses ≥ 50 KB are then written to disk, returned as a `resource_link`, and your client fetches the body only when it actually needs it. Cached payloads expire after 1 hour.

```jsonc
{
  "method": "GET",
  "url": "https://en.wikipedia.org/wiki/Web_scraping",
  "offload_large": true   // opt in for token savings
}
```

| Client | `offload_large: true` |
|---|---|
| Claude Desktop | not yet - leave default `false` |
| Claude Code, Cursor, Windsurf | supported |
| VS Code MCP extension | supported |

Tenant-isolated: only the API key that stored a payload can read it back.

## Other limits

- **Private targets are refused.** Requests to private or reserved IP ranges (RFC 5735, 6598, IPv6 reserved blocks) are blocked at the MCP layer. Only public-internet hosts are forwarded.
- **Rate limits** are enforced by the FourA API per service. Concurrency + RPM. Details at [foura.ai/docs/api/rate-limits](https://foura.ai/docs/api/rate-limits).
- **Body size cap** of 256 KB on incoming `/mcp` requests (real MCP payloads are < 4 KB).
- **DNS-rebinding defense:** the hosted server validates `Origin` and `Host` headers. Browser-based callers must originate from an allowlisted origin. Server-to-server callers (curl, MCP clients in stdio bridge mode) are unaffected.

## Self-Hosting

The MCP server runs in one container, statelessly - each request brings its own key, so there's no session state, no sticky load balancing, nothing to coordinate. Scale horizontally behind any load balancer.

Configurable environment:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3076` | HTTP listen port |
| `FOURA_API_BASE` | `https://api.foura.ai/api` | Upstream FourA REST base URL |
| `FOURA_MCP_PAYLOADS_DIR` | `/data/payloads` | Where ≥50 KB responses are cached on disk |

The full source is public here under MIT - build the container from the included [`Dockerfile`](./Dockerfile) (`docker build -t foura-mcp .`), or run it straight from npm with `npx -y @fouradata/mcp`. See [DEVELOPMENT.md](./DEVELOPMENT.md) for the local build and test workflow.

## License

MIT. See [`LICENSE`](./LICENSE).

## Links

- FourA (web scraping API): <https://foura.ai>
- MCP server page: <https://foura.ai/mcp>
- Source (GitHub): <https://github.com/fouradata/mcp>
- npm package: <https://www.npmjs.com/package/@fouradata/mcp>
- API documentation: <https://foura.ai/docs>
- MCP server reference: <https://foura.ai/docs/mcp/server>
- MCP error codes: <https://foura.ai/docs/mcp/errors>
- MCP recipes: <https://foura.ai/docs/mcp/recipes>
- REST API errors: <https://foura.ai/docs/api/errors>
- MCP specification: <https://modelcontextprotocol.io>
- Get a key: <https://foura.ai/dashboard/#api-keys>
