# Development

## Requirements

- Node >= 22.19 (Node 24 recommended)

## Setup

```bash
git clone https://github.com/fouradata/mcp
cd mcp
npm ci
```

## Run

- **stdio** (what MCP clients spawn): `npm run dev` - needs `FOURA_API_KEY` in the environment.
- **Streamable HTTP transport**: `npm run dev:http`, then POST MCP traffic to
  `http://localhost:3076/mcp`.
- **MCP Inspector**: `npm run inspector` - opens the interactive tool explorer.

## Build

`npm run build` compiles TypeScript to `dist/`.

## Test

- `npm run test:ci` - the deterministic release gate: lint, build, unit tests, mocked MCP
  integration, docs checks, syntax checks, token budget, and package audit.
- `npm test` - build + unit + live stdio integration + docs compliance.
- `npm run test:integration:http` - live HTTP transport suite.

The live integration suites spawn the server and call the FourA API, so they need a real
`FOURA_API_KEY` in the environment. `npm run test:ci` needs no production credential.

## Release

Releases go through a protected pull request, required CI, squash merge, and exact-tag preflight.
GitHub Actions publishes the verified tag to npm with provenance. Maintainers should follow
[RELEASING.md](./RELEASING.md).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FOURA_API_KEY` | (required) | Your FourA API key for tool calls. |
| `PORT` | `3076` | HTTP listen port (Streamable HTTP transport). |
| `FOURA_API_BASE` | `https://api.foura.ai/api` | Upstream FourA REST base URL. |
| `FOURA_MCP_PAYLOADS_DIR` | `/data/payloads` | Where responses >= 50 KB are cached on disk. |

---

FourA: https://foura.ai | MCP server: https://foura.ai/mcp | Docs: https://foura.ai/docs/mcp/server
