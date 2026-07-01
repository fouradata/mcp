# Security Policy

## Reporting a vulnerability

Email **security@foura.ai**. Please do not open a public issue for security reports.

Include the affected version, reproduction steps, and the impact you observed. We acknowledge
reports within 72 hours and aim to ship a fix for high or critical issues within 14 days.

## Scope

This repository is the MCP wrapper (`@fouradata/mcp`) - the protocol layer over the FourA REST
API. In scope: the tool surface, input handling (URLs, headers, request bodies), the stdio and
Streamable HTTP transports, the SSRF target guard, and the on-disk payload cache. Vulnerabilities
in the FourA API itself also go to security@foura.ai.

## Supported versions

Only the latest version published on npm is supported. Please upgrade before reporting.

## Disclosure

We credit reporters in the release notes by default. We ask for coordinated disclosure of up to
90 days from the fix shipping before public technical detail.

---

FourA web scraping API: https://foura.ai  ·  MCP server page: https://foura.ai/mcp  ·  Docs: https://foura.ai/docs/mcp/server
