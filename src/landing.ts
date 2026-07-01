// Discovery surfaces for the hosted server (mcp.foura.ai).
//
// The human-facing landing lives on the main site at https://foura.ai/mcp
// (a real page with the site chrome, theme, and i18n). This host is the MCP
// endpoint; a browser hitting the bare root is redirected there (the reverse
// proxy also does this at the edge). We keep the machine-readable llms.txt here
// because mcp.foura.ai is a separate host and crawlers hitting
// mcp.foura.ai/llms.txt should find a map without following the redirect.

export const LANDING_REDIRECT = "https://foura.ai/mcp";

export const LLMS_TXT = `# FourA MCP server

> The FourA web scraping API as a Model Context Protocol (MCP) server. One smart tool fetches any public web page - direct request, rotating proxy, or full browser - and gets past anti-bot challenges. Four tools, six prompts, one API key. Hosted at https://mcp.foura.ai/mcp (Streamable HTTP) and on npm as @fouradata/mcp (local stdio).

## Connect
- Hosted (Streamable HTTP): POST https://mcp.foura.ai/mcp with header "Authorization: Bearer pk_live_..."
- Local (stdio): npx -y @fouradata/mcp with env FOURA_API_KEY
- Get an API key: https://foura.ai/dashboard#api-keys
- Landing + configurator: https://foura.ai/mcp

## Tools
- foura_auto: smart fetch, picks direct / proxy / browser for you (the default)
- foura_single: one fast HTTP request (static pages, JSON APIs)
- foura_proxy: rotating proxy pool with retry (bypass WAF challenges)
- foura_browser: full browser session with JavaScript rendering

## Prompts
smart_fetch, scrape_product_page, extract_article, monitor_pricing, check_endpoint_health, bulk_fetch_urls

## Docs
- MCP server reference: https://foura.ai/docs/mcp/server
- Recipes: https://foura.ai/docs/mcp/recipes
- Error codes: https://foura.ai/docs/mcp/errors
- Source (GitHub, MIT): https://github.com/fouradata/mcp
- npm package: https://www.npmjs.com/package/@fouradata/mcp
`;
