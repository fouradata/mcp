// Human visitors get the product page; MCP-aware crawlers get a local llms.txt index.

export const LANDING_REDIRECT = "https://foura.ai/mcp";

export const LLMS_TXT = `# FourA MCP server

> Reliable web access for AI agents. Give FourA a public URL and get the content back through smart HTTP, rotating proxies, or a full browser. Four tools, six prompts, one API key. Hosted at https://mcp.foura.ai/mcp (Streamable HTTP) and on npm as @fouradata/mcp (local stdio).

## Connect
- Hosted (Streamable HTTP): POST https://mcp.foura.ai/mcp with header "Authorization: Bearer pk_live_..."
- Local (stdio): npx -y @fouradata/mcp with env FOURA_API_KEY
- Get an API key: https://foura.ai/dashboard#api-keys
- Landing + configurator: https://foura.ai/mcp

## Tools
- foura_auto: smart fetch, picks direct / proxy / browser for you (the default)
- foura_single: one fast HTTP request (static pages, JSON APIs)
- foura_proxy: rotating proxies with retry for blocked or geo-specific pages
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
