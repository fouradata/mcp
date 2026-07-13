# AGENTS.md

Agent-facing reference for the FourA MCP server (`@fouradata/mcp`). If you are an AI agent
deciding whether and how to use this server, read this.

## What this server does

Fetches arbitrary **public** web pages for you: static pages, JSON APIs, JavaScript-rendered
SPAs, and anti-bot-protected targets. It wraps the FourA web scraping API. All tools are
read-only (`readOnlyHint: true`) and reach the open web (`openWorldHint: true`).

## Tools (four)

- **`foura_auto`** - the default. Give it a `url`; it returns the content and picks the fetch
  method for you. Use this first unless you need explicit control. Optional
  `validate.data.accept` lets it tell a real page from a challenge page.
- **`foura_single`** - one fast HTTP request. Static pages and JSON APIs. Set
  `unblocker: true` for wire-level anti-bot targets.
- **`foura_proxy`** - the same request through a rotating proxy pool with retry. Use when a
  direct request is blocked; difficult protected targets may need `maxTries: 25-30`.
- **`foura_browser`** - a real browser session; JavaScript runs and the DOM finishes rendering.
  Use for SPAs and lazy-loaded content.

The primitives compose: `foura_proxy` returns a base36 proxy ID; pass it into
`foura_single.proxy` or `foura_browser.proxy` to reuse the same exit.

## Prompts (six)

`smart_fetch`, `scrape_product_page`, `extract_article`, `monitor_pricing`,
`check_endpoint_health`, `bulk_fetch_urls`. Each expands into a templated task that orchestrates
the tools for you.

## Errors

Every error carries a `structuredContent` envelope with `{service, code, error}` and, where
relevant, `status` / `retryAfter`. Read `code` for retry logic: `rate_limited`, `at_capacity`,
`service_unavailable`, `upstream_error` are retry-safe (respect `retryAfter`); `auth_failed`,
`bad_request`, `not_found`, `ssrf_blocked` are not. Full list: https://foura.ai/docs/mcp/errors.

## Auth

One API key (`FOURA_API_KEY` in stdio, or `Authorization: Bearer` on the hosted endpoint). Keys
can be created or revealed at https://foura.ai/dashboard/#api-keys.

## Limits

Public hosts only - private and reserved IP ranges are refused (`ssrf_blocked`). Rate and
concurrency limits are enforced per service. See https://foura.ai/docs/mcp/server.

---

FourA: https://foura.ai | MCP server: https://foura.ai/mcp | Docs: https://foura.ai/docs/mcp/server
