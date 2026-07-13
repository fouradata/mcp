import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractReleaseNotes,
  publishGitHubRelease,
} from "../../scripts/publish-github-release.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHANGELOG = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const WORKFLOW = readFileSync(resolve(ROOT, ".github/workflows/publish.yml"), "utf8");
const CURRENT_VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
const VERSION = "1.2.3";
const TAG = `v${VERSION}`;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const NOTES = `### Added
- First release note.
### Changed
- Second release note.`;
const FIXTURE_CHANGELOG = `# Changelog

## [${VERSION}] - 2026-07-13
${NOTES}

## [1.2.2] - 2026-07-12
### Fixed
- Older release note.
`;

function release(overrides = {}) {
  return {
    tag_name: TAG,
    name: TAG,
    target_commitish: SHA,
    body: NOTES,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/fouradata/mcp/releases/tag/${TAG}`,
    ...overrides,
  };
}

const options = {
  token: "test-token",
  repository: "fouradata/mcp",
  sha: SHA,
  tag: TAG,
  version: VERSION,
  changelog: FIXTURE_CHANGELOG,
};

describe("GitHub release publication", () => {
  test("extracts only the matching release section", () => {
    assert.equal(extractReleaseNotes(FIXTURE_CHANGELOG, VERSION), NOTES);
    assert.doesNotMatch(extractReleaseNotes(FIXTURE_CHANGELOG, VERSION), /Older release note/);
    assert.doesNotThrow(() => extractReleaseNotes(CHANGELOG, CURRENT_VERSION));
  });

  test("rejects a missing or duplicate release section", () => {
    assert.throws(() => extractReleaseNotes(FIXTURE_CHANGELOG, "9.9.9"), /exactly one/);
    assert.throws(() => extractReleaseNotes(`${FIXTURE_CHANGELOG}\n## [${VERSION}] - 2026-07-14\nDuplicate`, VERSION), /exactly one/);
  });

  test("accepts an exact existing release without creating another", async () => {
    const requests = [];
    const result = await publishGitHubRelease({
      ...options,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return Response.json(release());
      },
    });

    assert.deepEqual(result, { created: false, url: release().html_url });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/releases\/tags\/v1\.2\.3$/);
    assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  });

  test("creates a stable release after a missing-tag response", async () => {
    const requests = [];
    const result = await publishGitHubRelease({
      ...options,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        if (requests.length === 1) return new Response(null, { status: 404 });
        return Response.json(release(), { status: 201 });
      },
    });

    assert.deepEqual(result, { created: true, url: release().html_url });
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /\/releases$/);
    assert.equal(requests[1].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      tag_name: TAG,
      target_commitish: SHA,
      name: TAG,
      body: NOTES,
      draft: false,
      prerelease: false,
      generate_release_notes: false,
      make_latest: "true",
    });
  });

  test("fails closed when an existing release differs", async () => {
    await assert.rejects(
      publishGitHubRelease({
        ...options,
        fetchImpl: async () => Response.json(release({ prerelease: true })),
      }),
      /prerelease state/,
    );
  });

  test("publishes only after npm with a minimal write permission", () => {
    assert.match(WORKFLOW, /github-release:\n\s+needs: publish/);
    assert.match(WORKFLOW, /github-release:[\s\S]*?permissions:\n\s+contents: write/);
    assert.match(WORKFLOW, /node scripts\/publish-github-release\.mjs "\$GITHUB_REF_NAME"/);
    assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  });
});
