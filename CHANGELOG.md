# Changelog

All notable changes to `@fouradata/mcp`. Format: [Keep a Changelog](https://keepachangelog.com); [SemVer](https://semver.org).

## [0.7.0] - 2026-09-16
### Added
- `foura_proxy` accepts `exitClass`. `premium` allows a request to escalate to a premium exit when the standard pool cannot deliver it; it is an allowance, not an instruction, and a request the standard pool answers first costs no premium traffic. The response reports which class served. `standard` forbids escalation. On a plan without premium exits the call is refused with `code: "plan_limit_premium"`.
- A failed `foura_proxy` rotation returns `attemptReport`: one `summary` sentence plus counts that separate exits that never answered, exits a bot check refused, and pages that arrived and were rejected only by your own `validate` rule. `profilesTried` lists the browsers the task sent.
- A successful `foura_proxy` response reports `profile` when the rotation moved to another browser family to get the answer, so a replay sends the request that worked rather than the one that failed.
- Every tool reports `credits` (what the call spent, on failures too) and `request_id` (quote it in a support request). `foura_single` and `foura_browser` report `exitClass` when a premium exit served the call.
### Security
- Refreshed dependencies to clear published advisories in `fast-uri`, `hono` and `qs`. `npm audit` reports no known vulnerabilities. No API change.
### Changed
- A refusal raised by your own plan keeps its reason as the error `code`: `plan_limit_credits`, `plan_limit_bandwidth`, `plan_limit_rate`, `plan_limit_concurrency`, `plan_limit_browser_daily`, `plan_limit_premium`, `plan_limit_feature`. It used to arrive as a plain `forbidden` or `rate_limited`, which reads like the target blocking the request and invites a retry through another tool that is refused as well. Where a wait clears the refusal, `retryAfter` carries it.

## [0.6.0] - 2026-08-06
### Added
- `foura_single` and `foura_proxy` accept an optional browser profile: `browser`, `os`, `version`, or an exact `profile` id. Omitting them keeps the previous behaviour, the current Chrome. The catalogue is public at https://api.foura.ai/api/profiles. A combination that does not exist returns an error listing what is available instead of sending a different browser.
- Both tools now surface `defense` when the target ran a bot check. `defense.solved: false` means the body may be a challenge page, so an agent can retry with another browser profile or escalate.
### Fixed
- The `unblocker` description on `foura_single` and `foura_proxy` said the default was off. It has always been on, so requests already carried a full browser header set. The schema text now matches the behaviour.
### Security
- Updated the MCP SDK to 1.30.0 and dependencies to clear published advisories in `undici`, `hono`, `@hono/node-server`, `fast-uri`, `ip-address` and `body-parser`. `npm audit` reports no known vulnerabilities.

## [0.5.0] - 2026-07-13
### Added
- `foura_proxy` accepts an optional `exitCountries` allowlist and returns the selected `exitCountry` on a scoped success. Unknown exits are excluded and no eligible scope is silently dropped.
### Changed
- Tool guidance now makes protected-content validation, offloaded resource reads, and strict country-scope error handling explicit.
- The minimum supported Node version is now 22.19, matching the runtime requirement of the HTTP client dependency.

## [0.4.8] - 2026-07-02
### Security
- The HTTP transport now requires credentials on each request. Stdio mode continues to read
  `FOURA_API_KEY` from the environment.
- Updated dependencies to clear a denial-of-service advisory. No API change.
- The HTTP server no longer emits the `X-Powered-By` response header.
### Changed
- Minimum supported Node is now 22 LTS (was 20, which has reached end-of-life). Node 22 and 24 are
  the active LTS lines.

## [0.4.7] - 2026-07-01
### Changed
- Completed the expanded tool-schema descriptions. No runtime change.

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
- 401 responses now use a Bearer challenge that matches the server's API-key authentication.

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
- The package now builds and publishes from the public GitHub repository with npm provenance and
  verified source links. Runtime behaviour is unchanged from 0.3.1.

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
