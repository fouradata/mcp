# Using the FourA MCP with Claude

Setup notes specific to Claude Desktop, Claude Code, and the Claude API. For the full tool and
prompt reference see [README.md](./README.md) and [AGENTS.md](./AGENTS.md).

## Claude Code

```bash
export FOURA_API_KEY=pk_live_...
claude mcp add foura -- npx -y @fouradata/mcp
```

Or connect to the hosted endpoint (Streamable HTTP):

```bash
claude mcp add --transport http foura https://mcp.foura.ai/mcp --header "Authorization: Bearer pk_live_..."
```

## Claude Desktop

Add this to `claude_desktop_config.json` (Settings -> Developer -> Edit Config):

```json
{
  "mcpServers": {
    "foura": {
      "command": "npx",
      "args": ["-y", "@fouradata/mcp"],
      "env": { "FOURA_API_KEY": "pk_live_..." }
    }
  }
}
```

**Gotcha:** fully quit Claude Desktop (`Cmd+Q` on macOS) before editing the config - if it is
still running it overwrites your edits with its in-memory config on exit. Current Desktop builds
reject a bare remote `url`, so use the stdio config above (or bridge with `mcp-remote`).

`offload_large` is not supported on Claude Desktop yet (it cannot read `resource_link` blocks) -
leave it at the default `false`. Claude Code and Cursor support it.

## What you get

Four tools (`foura_auto`, `foura_single`, `foura_proxy`, `foura_browser`) and six prompts under
`/prompts`. All tools are read-only, so Claude clients that auto-approve trusted read-only tools
call them without a per-request confirmation prompt. Start with `foura_auto` - give it a URL and
it returns the page, choosing the fetch method for you.

---

FourA web scraping API: https://foura.ai  ·  MCP server page: https://foura.ai/mcp  ·  Docs: https://foura.ai/docs/mcp/server
