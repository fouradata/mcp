<!-- mcp-name: ai.foura/mcp -->
<p align="center">
  <a href="https://foura.ai/mcp"><img src="https://foura.ai/logo/avatars/4a-transparent-indigo-512.png" width="96" alt="FourA"></a>
</p>

<h1 align="center">FourA MCP</h1>

<p align="center"><strong>Reliable web access for AI agents.</strong></p>

<p align="center">
  Give your agent a public URL. FourA returns the content, whether the page needs a fast HTTP request,
  proxy rotation, or a full browser session.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fouradata/mcp"><img src="https://img.shields.io/npm/v/@fouradata/mcp?logo=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fouradata/mcp"><img src="https://img.shields.io/badge/supply_chain-provenance_signed-2ea44f?logo=npm" alt="npm provenance"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@fouradata/mcp?color=2ea44f" alt="MIT license"></a>
  <a href="https://glama.ai/mcp/servers/fouradata/mcp"><img src="https://glama.ai/mcp/servers/fouradata/mcp/badges/score.svg" alt="FourA MCP score on Glama"></a>
  <a href="https://smithery.ai/servers/foura/mcp"><img src="https://smithery.ai/badge/foura/mcp" alt="FourA on Smithery"></a>
</p>

Start with `foura_auto`: one URL in, typed content out. It chooses the appropriate fetch method and handles common blocks for you. Use `foura_single`, `foura_proxy`, or `foura_browser` when you want explicit control over the request path.

| Start simple | Reach difficult pages | Build predictable agent flows |
|---|---|---|
| One default tool for most URLs | HTTP, proxy rotation, and full-browser rendering | Typed outputs, stable error codes, and six ready-made prompts |

The included workflows cover product extraction, article cleanup, price monitoring, endpoint checks, and bulk URL fetching.

Use it from Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, or any MCP client. Run the npm package locally or connect to the hosted Streamable HTTP endpoint with the same FourA API key.

**[Get an API key](https://foura.ai/dashboard/#api-keys) | [Read the MCP docs](https://foura.ai/docs/mcp/server) | [See the package on npm](https://www.npmjs.com/package/@fouradata/mcp)**

**One-click install:**

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=foura&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3VyYWRhdGEvbWNwIl0sImVudiI6eyJGT1VSQV9BUElfS0VZIjoiWU9VUl9GT1VSQV9BUElfS0VZIn19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522foura%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540fouradata%252Fmcp%2522%255D%252C%2522env%2522%253A%257B%2522FOURA_API_KEY%2522%253A%2522YOUR_FOURA_API_KEY%2522%257D%257D)

Both buttons pre-fill the config with a `YOUR_FOURA_API_KEY` placeholder - replace it with your key. Or by hand: `claude mcp add foura -- npx -y @fouradata/mcp` (set `FOURA_API_KEY` in env first). Full per-client setup below.

## Quick Start - local stdio (recommended for Claude Desktop)

Create or reveal an API key at [foura.ai/dashboard/#api-keys](https://foura.ai/dashboard/#api-keys) (format `pk_live_...`). Then drop this into your MCP client's config:

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

The npx command downloads the package on first launch and runs it as a subprocess of your MCP client. No global install needed. The same JSON works across MCP clients; only the config-file location changes:

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

If your client supports the Streamable HTTP transport, point it at the hosted endpoint instead of running a local subprocess:

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

For Claude Desktop, use the stdio config above. You can also bridge the hosted endpoint through `mcp-remote`:

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

`foura_auto` is the **default** - give it a URL and it returns the content, choosing the fetch method for you. The other three tools give you direct control over HTTP, proxy rotation, and browser rendering.

All four are marked `readOnlyHint: true` and `openWorldHint: true` per the [MCP specification](https://modelcontextprotocol.io/specification). Clients can use those annotations when deciding how to present or approve tool calls.

Every response carries human-readable text (`content`) plus a typed `structuredContent` JSON object validated against the tool's `outputSchema`. Your agent gets a predictable response contract instead of parsing prose.

### `foura_auto` - smart fetch (the default)

Give it a URL and get the content back. Use this first when you don't want to choose between HTTP, proxy rotation, and browser rendering. It handles common bot challenges and keeps the client surface small, with no proxy-attempt tuning required.

```jsonc
{
  "url": "https://example.com",
  // optional: a substring the real page must contain, so auto can tell a
  // real page from a challenge page on protected targets
  "validate": { "data": { "accept": ["Example Domain"] } }
}
```

The client surface is intentionally minimal: `url` (required), plus optional `method`, `headers`, `data`, `validate`, `returnSession` (default `true`), `forceProxy` (default `true`), `timeout_ms` (5000-180000, default 120000), `ignoreProxies`.

`structuredContent` shape: `{status, headers, data, meta, session}`. `meta` is always present - `{rung, solved, attempts, credits}` - so your agent can see how the request completed and how many credits it used. `session` (`{proxy, cookies, userAgent}`) is returned by default for follow-up requests (pass `session.proxy` into the `proxy` field). Send `returnSession: false` to omit it. There is no `total_time` field on auto.

### `foura_single` - fast HTTP

One HTTP request, response back. Use it for static pages, JSON APIs, and server-rendered HTML. Set `unblocker: true` if the target is picky about wire-level signals.

```jsonc
{
  "method": "GET",
  "url": "https://example.com",
  "unblocker": true
}
```

Supports custom headers, a body, per-stage timeouts, redirect controls, JSON auto-parse, a binary-buffer mode, and built-in response validation (`validate.status.accept`, `validate.data.fail`, and so on). If `foura_single` comes back blocked - status 403/429, a captcha page, challenge response headers, or a known challenge title - escalate to `foura_proxy`. Start with `maxTries: 5`; protected targets may need `25-30`. If the page also needs JavaScript to render, pass `foura_proxy`'s returned `proxy` ID to `foura_browser.proxy`.

`structuredContent` shape: `{status, headers, data, total_time, ...}`.

### `foura_proxy` - rotating proxies with retry

Same target shape as `foura_single`, but routed through rotating proxies with automatic retry on failure. Use it when a direct request is blocked or when the target requires a specific exit country.

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

`structuredContent` adds `proxy` (the encoded ID of the proxy that succeeded) and `total` (outer timing including selection and retries). `exitCountries` is optional: values are trimmed, uppercased, and deduplicated; proxies with unknown exits are excluded; the request never falls back to an unrequested country. Selection uses the latest available country metadata, normally updated within ten minutes, and a scoped success returns that value as `exitCountry`. If no eligible proxy matches, the result uses `code: "no_eligible_proxy"`.

For difficult WAF challenges, use `maxTries: 25-30`. For a country allowlist, set `exitCountries` instead of increasing attempts. If the target needs JavaScript rendering, pass the returned `proxy` ID to `foura_browser.proxy`.

### `foura_browser` - full browser session

A real browser session. JavaScript runs, the DOM finishes rendering, cookies come back with the response. Use it when the page is a single-page app, when content lazy-loads after first paint, or when there's an anti-bot challenge that needs a real browser to clear.

```jsonc
{
  "url": "https://example.com/spa",
  "timeout_ms": 15000,
  "checkText": "data-table"
}
```

Use this when an HTTP response isn't enough. `checkText` validates the rendered HTML once navigation completes; it doesn't wait or poll. If the substring is missing, the call fails with an error envelope. This catches pages that return 200 without the content you need. `unblocker` defaults to `true` and handles supported anti-bot or captcha challenges along the way. Set it to `false` to return the page exactly as it loads, challenge included.

`structuredContent` shape is intentionally different from single/proxy: `{status, headers (object, not array), body (not data), cookies (full browser cookie shape), userAgent}`.

## Built-in Prompts

Six workflow templates surfaced under `/prompts` in your MCP client. They orchestrate one or more tools without you spelling out the steps.

| Prompt | Arguments | What it does |
|---|---|---|
| `smart_fetch` | `url, must_contain?, extract?` | Pick the method, handle bot protection, and return or extract content |
| `scrape_product_page` | `url` | Extract title, price, image, stock, and SKU as JSON in a browser session |
| `extract_article` | `url` | Fetch an article, retry through a proxy if needed, and remove page chrome |
| `monitor_pricing` | `url, target_price?` | Fetch the current price and compare it with a target |
| `check_endpoint_health` | `url, expected_text?` | Validate reachability, status, content, and timing |
| `bulk_fetch_urls` | `urls` (comma-separated) | Fetch URLs in parallel, retry blocked ones, and return metadata |

Each prompt arrives as a templated user message your LLM executes with the right tools. The full prompt text enters the context only when you invoke it.

Full recipe text + manual fallback prompts: [foura.ai/docs/mcp/recipes](https://foura.ai/docs/mcp/recipes). For the full error code list, see [foura.ai/docs/mcp/errors](https://foura.ai/docs/mcp/errors).

## Authentication

Use `FOURA_API_KEY` in stdio mode or an `Authorization: Bearer pk_live_...` header with the hosted endpoint. One key authenticates all four tools.

Keys are managed in the [dashboard](https://foura.ai/dashboard/#api-keys), where you can create, reveal, rotate, or deactivate them. See [foura.ai/docs/getting-started/authentication](https://foura.ai/docs/getting-started/authentication) for the full key-management walkthrough.

## Error envelope - typed contract for agent retries

Every error (`isError: true`) carries a `structuredContent` envelope with at minimum these three fields:

```jsonc
{
  "service": "auto" | "single" | "proxy" | "browser",
  "code": "ssrf_blocked" | "auth_failed" | "rate_limited" | ...,
  "error": "Human-readable message"
}
```

Where the upstream returned a status, you also get `status` (HTTP code) and on rate-limit / capacity errors the FourA API envelope adds `retryAfter`, `current.{concurrency, rpm}`, `limits.{maxConcurrency, maxRpm}`.

| `code` | When | Retry safe? |
|---|---|---|
| `ssrf_blocked` | Target resolves to a private or reserved address | No - change the URL |
| `upstream_non_json` | Upstream returned malformed body | Maybe - investigate |
| `bad_request` (400) | Input shape rejected by FourA | No - fix arguments |
| `auth_failed` (401) | Key missing, invalid, or deactivated | No - fix the key |
| `forbidden` (403) | Authenticated but not allowed | No |
| `not_found` (404) | Target / endpoint doesn't exist | No |
| `rate_limited` (429) | RPM cap hit | Yes - wait `retryAfter` |
| `at_capacity` (503) | Concurrency cap hit | Yes - wait `retryAfter` |
| `service_disabled` (503) | Maintenance window | Yes - wait `retryAfter` |
| `service_unavailable` (503) | Generic 503 | Yes - short backoff |
| `upstream_error` (`>=500`) | Upstream 5xx | Yes - exponential backoff |
| `upstream_client_error` (4xx) | Other 4xx | Usually no |
| `no_eligible_proxy` | No proxy matches the requested `exitCountries` | No - change the country scope |

LLM agents can read `code` directly for retry logic without parsing prose. Spec reference: [foura.ai/docs/api/errors](https://foura.ai/docs/api/errors).

## Combining the tools - reuse the same exit

The lower-level tools compose. `foura_proxy` returns the base36 ID of the exit it used. Pass that ID into `foura_single.proxy` or `foura_browser.proxy` to reuse the same exit for the next request.

```jsonc
// 1. Find a working exit. Difficult protected targets may need maxTries:25-30.
const r = await foura_proxy({
  maxTries: 30,
  request: { method: "GET", url: "https://probe.example.com", unblocker: true }
});
// Returns { status: 200, proxy: "4DZ3VE", ... }

// 2. Reuse it for follow-up HTTP
await foura_single({ method: "GET", url: "https://target/api", proxy: r.proxy });

// 3. Or render JavaScript through the same exit.
await foura_browser({ url: "https://target/spa", proxy: r.proxy });
```

For a protected JavaScript page, find a working route with `foura_proxy` before calling `foura_browser`. Starting in the browser can return the challenge page before the real content loads.

To choose a different proxy on the next `foura_proxy` call, pass the previous ID as `ignoreProxies: ["4DZ3VE"]`. The `proxy` field on `foura_single` and `foura_browser` also accepts raw URLs (`http://host:port`, `socks5://...`) if you have your own list.

## Large responses - `offload_large` (default: inline)

By default (since v0.2.0), full response bodies are returned inline in `structuredContent` regardless of size. This works in every MCP client.

If your client supports MCP `resources/read` (and you want to save tokens on big pages), pass `offload_large: true` per tool call. Responses of 50 KB or more are returned as a `resource_link`, and your client fetches the body only when it needs it. The resource remains available for one hour.

```jsonc
{
  "method": "GET",
  "url": "https://en.wikipedia.org/wiki/Web_scraping",
  "offload_large": true   // opt in for token savings
}
```

Support for MCP resource links varies by client. Leave `offload_large` at its default `false` if your client can't read `resource_link` blocks.

Only the API key that created an offloaded resource can read it back.

## Limits and responsible use

- **Private targets are refused.** Requests to private or reserved addresses are blocked at the MCP layer. Only public-internet hosts are forwarded.
- **Rate limits** are enforced by the FourA API per service. Concurrency + RPM. Details at [foura.ai/docs/api/rate-limits](https://foura.ai/docs/api/rate-limits).

Use FourA only for public content you are authorized to access and in accordance with the target site's terms and applicable law.

## Run it yourself

Run the stdio server directly from npm with `npx -y @fouradata/mcp`, or build the included [`Dockerfile`](./Dockerfile) for the Streamable HTTP transport.

Configurable environment:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3076` | HTTP listen port |
| `FOURA_API_BASE` | `https://api.foura.ai/api` | Upstream FourA REST base URL |
| `FOURA_MCP_PAYLOADS_DIR` | `/data/payloads` | Where responses of 50 KB or more are cached on disk |

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the local build and test workflow.

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
