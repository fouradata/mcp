# Releasing

Versioning follows [SemVer](https://semver.org). `npm run bump <patch|minor|major>` updates the
package, lockfile, server metadata, and tool User-Agent version anchors together. It refuses to
run on a dirty tree or when the current anchors disagree.

## Flow

1. Start from a clean release branch with the feature work committed.
2. Run `npm run bump <patch|minor|major>`.
3. Add the dated `[x.y.z]` entry to `CHANGELOG.md`.
4. Run `npm run test:ci` and review the full diff plus packed package contents.
5. Commit and push the release branch. Open a pull request to `main`.
6. Wait for required CI and squash-merge the pull request.
7. Check out the exact merged `main` commit in a clean worktree. Run `npm ci`,
   `npm run test:ci`, and `npm run verify:release -- vX.Y.Z` again.
8. Tag that verified commit and push the immutable `vX.Y.Z` tag.

The publish workflow verifies the tag, version anchors, tests, and package allowlist before npm
publishes with provenance. Never move or reuse a release tag.
