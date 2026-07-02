# Changelog

All notable changes to `@fouradata/mcp`. Format: [Keep a Changelog](https://keepachangelog.com); [SemVer](https://semver.org).

## [0.4.8] - 2026-07-02
### Security
- The HTTP transport no longer falls back to the server's `FOURA_API_KEY` environment variable
  when a request arrives without a key. Each HTTP request must carry its own
  `Authorization: Bearer pk_live_...`; the env var is honoured only in stdio mode. This prevents
  an unauthenticated request from ever borrowing the host operator's key.
- Bumped the transitive `qs` dependency to 6.15.3, clearing a denial-of-service advisory. No API
  change.
- The HTTP server no longer emits the `X-Powered-By` response header.
### Changed
- Minimum supported Node is now 22 LTS (was 20, which has reached end-of-life). Node 22 and 24 are
  the active LTS lines.

## [0.4.7] - 2026-07-01
### Changed
- Raised the tool-schema token budget 10000 -> 11000 to fit the now fully-described input
  parameters (internal build check only; no runtime change).

## [0.4.6] - 2026-07-01
### Changed
- Described the remaining `validate` config groups (status / headers / data) on `foura_single`,
  `foura_proxy` and `foura_auto`, so every tool input parameter now carries a description.

## [0.4.5] - 2026-07-01
### Changed
- Every tool input parameter now has a description (added the fine-grained timeout knobs on
  `foura_single`/`foura_proxy`, the proxy `tryJsonData`/`returnBuffer` flags, and the browser
  cookie fields).
- The server now advertises `title`, `description`, `websiteUrl` and an icon in its `initialize`
  metadata, so clients and registries can show richer listing info.

## [0.4.4] - 2026-07-01
### Changed
- Capability discovery is now public: `initialize`, `tools/list`, `prompts/list`, `prompts/get`
  and `resources/list` no longer require an API key, so any client or registry can enumerate the
  server's tools and prompts before a user provides one. `tools/call` (execution) and
  `resources/read` (a tenant's offloaded payloads) still require the key.

## [0.4.3] - 2026-07-01
### Fixed
- 401 `WWW-Authenticate` is now a plain Bearer challenge (dropped the RFC 9728 `resource_metadata`
  hint). It advertised an OAuth flow the server does not implement, which made MCP gateways loop
  trying to authorize instead of sending the API key.

## [0.4.2] - 2026-07-01
### Changed
- HTTP transport: also accept the API key as a bare `Authorization: <key>` header (in addition to
  `Authorization: Bearer <key>`), for MCP gateways that forward the raw key.

## [0.4.1] - 2026-07-01
### Added
- `mcpName` in `package.json` so `@fouradata/mcp` is discoverable in the official MCP Registry.
### Changed
- Shorter one-line description for registry listings.

## [0.4.0] - 2026-07-01
### Added
- README install badges (npm version, downloads, provenance, license) plus one-click install
  buttons ("Add to Cursor", "Install in VS Code") and per-client setup.
- `server.json` (with an `mcp-name` marker) for the official MCP registry; `smithery.yaml` and
  `.mcp.json` for registries and client config.
- Community and trust files: SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, AGENTS, CLAUDE, DEVELOPMENT,
  issue and pull-request templates, and Dependabot config.
### Changed
- Fixed the npm `description` (ASCII hyphens, four tools) and updated `homepage`.
- Refreshed documentation links across the README and the other `.md` files.

## [0.3.3] - 2026-07-01
### Changed
- README: added GitHub source and npm package links.

## [0.3.2] - 2026-07-01
### Changed
- The package now builds and publishes from the public GitHub repository with npm provenance.
  Runtime behaviour is unchanged from 0.3.1; internal-only code comments and helper names were
  cleaned up for the public source.

## [0.3.1] - 2026-07-01
### Changed
- Documentation and copy accuracy across the README and tool descriptions.

## [0.3.0] - 2026-06-30
### Added
- `foura_auto` - a smart-default tool: give it a URL and it returns the content, automatically
  choosing between a direct request, a rotating proxy, or a full browser session and getting past
  common bot challenges. Minimal input (`url` plus a few options); returns the content, a `meta`
  trace of what it did, and a reusable `session` for follow-up requests.
- `smart_fetch` prompt - one-call content fetch via `foura_auto`.
### Changed
- `foura_browser` gained an `unblocker` flag (default true) to actively solve anti-bot / captcha
  challenges; set false to render a page as-is.
- `foura_auto` and `foura_proxy` support `followRedirects`.

## [0.2.x]
Earlier releases established the three lower-level tools (`foura_single`, `foura_proxy`,
`foura_browser`), typed `structuredContent` responses, a stable error-code envelope, SSRF
protection, and the built-in workflow prompts. See the git tags for details.
