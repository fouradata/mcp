# Releasing

Versioning follows [SemVer](https://semver.org). The version literal lives in seven places, kept in
sync by `npm run bump <patch|minor|major>`:

1. `package.json`
2. `src/http.ts` - `SERVER_VERSION`
3. `src/server.ts` - `McpServer({ version })`
4-7. `src/tools/{single,proxy,browser,auto}.ts` - `User-Agent`

## Flow
1. Add a `[x.y.z]` entry to `CHANGELOG.md`.
2. `npm run bump <patch|minor|major>`
3. `npm run lint && npm run build && npm run test:unit`
4. Commit, then push a `vX.Y.Z` tag. GitHub Actions publishes to npm with provenance.
