# Development

## Requirements

- Node >= 20 (Node 24 recommended)

## Setup

```bash
git clone https://github.com/fouradata/mcp
cd mcp
npm install
```

## Run

- **stdio** (what MCP clients spawn): `npm run dev` - needs `FOURA_API_KEY` in the environment.
- **hosted HTTP transport**: `npm run dev:http`, then POST MCP traffic to
  `http://localhost:3076/mcp`.
- **MCP Inspector**: `npm run inspector` - opens the interactive tool explorer.

## Build

`npm run build` compiles TypeScript to `dist/`.

## Test

- `npm run lint` - typecheck only (`tsc --noEmit`).
- `npm test` - build + unit + stdio integration + docs compliance.
- `npm run test:integration:http` - HTTP transport suite.

Integration tests spawn the server and call the live FourA API, so they need a real
`FOURA_API_KEY` in the environment. Unit and docs-compliance tests do not.

## Release

Edit `CHANGELOG.md`, then `npm run bump <patch|minor|major>` (updates every version anchor at
once), commit, and push the `vX.Y.Z` tag. GitHub Actions publishes to npm with build provenance.
See [RELEASING.md](./RELEASING.md).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FOURA_API_KEY` | (required) | Your FourA API key, forwarded upstream as `X-API-Key`. |
| `PORT` | `3076` | HTTP listen port (hosted transport). |
| `FOURA_API_BASE` | `https://api.foura.ai/api` | Upstream FourA REST base URL. |
| `FOURA_MCP_PAYLOADS_DIR` | `/data/payloads` | Where responses >= 50 KB are cached on disk. |

---

FourA web scraping API: https://foura.ai  ·  MCP server page: https://foura.ai/mcp  ·  Docs: https://foura.ai/docs/mcp/server
