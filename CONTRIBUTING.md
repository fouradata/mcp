# Contributing

Thanks for helping improve the FourA MCP server.

## Issues

- **Bugs** - include your MCP client, the package version (`npm view @fouradata/mcp version`), and
  a minimal reproduction.
- **Features** - describe the use case first: what you are trying to do with an agent.
- **Security** - do NOT open a public issue. See [SECURITY.md](./SECURITY.md).

## Pull requests

1. Fork and branch from `main`.
2. `npm install`, make your change, add or update tests.
3. `npm run lint && npm test` must pass.
4. Keep the docs style: ASCII hyphens only (no em or en dashes), user-facing prose, and accurate
   tool and prompt counts (four tools, six prompts).
5. Open the PR with a clear "what" and "why". We squash-merge.

There is no CLA. Contributions are accepted under the repository's MIT license.

## Local development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup, run, build, and test commands.

---

FourA web scraping API: https://foura.ai  ·  MCP server page: https://foura.ai/mcp  ·  Docs: https://foura.ai/docs/mcp/server
