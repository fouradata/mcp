#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReleaseNotes(changelog, version) {
  const header = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`);
  const lines = changelog.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => (header.test(line) ? [index] : []));

  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one dated ${version} release header`);
  }

  const start = matches[0] + 1;
  const nextHeader = lines.findIndex((line, index) => index >= start && /^## \[/.test(line));
  const end = nextHeader === -1 ? lines.length : nextHeader;
  const notes = lines.slice(start, end).join("\n").trim();

  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${version}`);
  return notes;
}

function validateRepository(repository) {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format");
  }
  return parts.map(encodeURIComponent).join("/");
}

function assertRelease(release, expected) {
  const failures = [];
  if (release.tag_name !== expected.tag) failures.push("tag");
  if (release.name !== expected.tag) failures.push("name");
  if (release.target_commitish !== expected.sha) failures.push("target commit");
  if (release.body !== expected.body) failures.push("release notes");
  if (release.draft !== false) failures.push("draft state");
  if (release.prerelease !== false) failures.push("prerelease state");
  if (failures.length > 0) {
    throw new Error(`GitHub release does not match the verified tag: ${failures.join(", ")}`);
  }
}

async function readJson(response, action) {
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub returned an invalid response while ${action}`);
  }
}

export async function publishGitHubRelease({
  token,
  repository,
  sha,
  tag,
  version,
  changelog,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  requireValue(token, "GITHUB_TOKEN");
  requireValue(repository, "GITHUB_REPOSITORY");
  requireValue(sha, "GITHUB_SHA");
  requireValue(tag, "release tag");
  requireValue(version, "package version");

  const expectedTag = `v${version}`;
  if (tag !== expectedTag) throw new Error(`tag ${tag} does not match ${expectedTag}`);

  const repositoryPath = validateRepository(repository);
  const body = extractReleaseNotes(changelog, version);
  const expected = { tag, sha, body };
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "fouradata-mcp-release",
    "X-GitHub-Api-Version": API_VERSION,
  };
  const baseUrl = apiUrl.replace(/\/$/, "");
  const tagUrl = `${baseUrl}/repos/${repositoryPath}/releases/tags/${encodeURIComponent(tag)}`;
  const existingResponse = await fetchImpl(tagUrl, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (existingResponse.status === 200) {
    const release = await readJson(existingResponse, "checking the existing release");
    assertRelease(release, expected);
    return { created: false, url: release.html_url };
  }
  if (existingResponse.status !== 404) {
    throw new Error(`GitHub release lookup returned HTTP ${existingResponse.status}`);
  }

  const createResponse = await fetchImpl(`${baseUrl}/repos/${repositoryPath}/releases`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: tag,
      body,
      draft: false,
      prerelease: false,
      generate_release_notes: false,
      make_latest: "true",
    }),
  });
  if (createResponse.status !== 201) {
    throw new Error(`GitHub release creation returned HTTP ${createResponse.status}`);
  }

  const release = await readJson(createResponse, "creating the release");
  assertRelease(release, expected);
  return { created: true, url: release.html_url };
}

async function main() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
  const result = await publishGitHubRelease({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    tag: process.argv[2],
    version: pkg.version,
    changelog,
    apiUrl: process.env.GITHUB_API_URL,
  });
  console.log(result.created ? `Created ${result.url}` : `Verified existing ${result.url}`);
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`GitHub release publication failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
