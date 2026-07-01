# Changelog

All notable changes to `@fouradata/mcp`. Format: [Keep a Changelog](https://keepachangelog.com); [SemVer](https://semver.org).

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
